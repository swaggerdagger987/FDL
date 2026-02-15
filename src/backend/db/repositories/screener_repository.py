from __future__ import annotations

import re
from collections.abc import Iterable

from sqlalchemy import text
from sqlalchemy.engine import Connection

import live_data

STAT_KEY_PATTERN = re.compile(r"^[a-z0-9_]{1,80}$")
BASE_SORT_KEYS = {
    "player_name": "p.full_name",
    "position": "p.position",
    "team": "p.team",
    "age": "COALESCE(p.age, {null_fill})",
    "fantasy_points_ppr": "COALESCE(ls.fantasy_points_ppr, {null_fill})",
}


def _normalize_stat_key(value: str) -> str:
    token = live_data.normalize_stat_key(value)
    if not token or not STAT_KEY_PATTERN.match(token):
        return ""
    return token


def _normalize_positions(raw: Iterable[str] | str | None) -> list[str]:
    positions: list[str] = []
    if raw is None:
        return positions
    if isinstance(raw, str):
        raw_iter = raw.split(",")
    else:
        raw_iter = raw
    for item in raw_iter:
        token = str(item or "").strip().upper()
        if token:
            positions.append(token)
    return list(dict.fromkeys(positions))


def _normalize_filters(filters: list[dict] | None) -> list[dict]:
    out: list[dict] = []
    for raw in filters or []:
        key = _normalize_stat_key(str(raw.get("key") or raw.get("stat_key") or ""))
        if not key:
            continue
        op = live_data.normalize_filter_operator(raw.get("op") or raw.get("operator"))
        value = live_data.parse_float(raw.get("value"))
        value_max = live_data.parse_float(raw.get("value_max") or raw.get("value2") or raw.get("max"))
        if op == "between":
            if value is None or value_max is None:
                continue
            out.append({"key": key, "op": op, "value": min(value, value_max), "value_max": max(value, value_max)})
        else:
            if value is None:
                continue
            out.append({"key": key, "op": op, "value": value, "value_max": None})
        if len(out) >= live_data.MAX_SCREEN_FILTERS:
            break
    return out


def _metric_filter_sql(alias: str, metric_filter: dict) -> tuple[str, dict[str, float]]:
    op = metric_filter["op"]
    value = metric_filter["value"]
    value_max = metric_filter.get("value_max")

    if op == "lt":
        return f"{alias}.stat_value < :{alias}_value", {f"{alias}_value": value}
    if op == "lte":
        return f"{alias}.stat_value <= :{alias}_value", {f"{alias}_value": value}
    if op == "gt":
        return f"{alias}.stat_value > :{alias}_value", {f"{alias}_value": value}
    if op == "eq":
        return f"{alias}.stat_value = :{alias}_value", {f"{alias}_value": value}
    if op == "neq":
        return f"{alias}.stat_value != :{alias}_value", {f"{alias}_value": value}
    if op == "between":
        return (
            f"{alias}.stat_value BETWEEN :{alias}_value_min AND :{alias}_value_max",
            {f"{alias}_value_min": value, f"{alias}_value_max": value_max},
        )
    return f"{alias}.stat_value >= :{alias}_value", {f"{alias}_value": value}


def _dedupe_metric_keys(keys: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for key in keys:
        normalized = _normalize_stat_key(key)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out[:80]


def query_screener(connection: Connection, payload: dict) -> dict:
    search = str(payload.get("search") or "").strip().lower()
    positions = _normalize_positions(payload.get("positions") or payload.get("position"))
    team = str(payload.get("team") or "").strip().upper()

    age_min = live_data.parse_float(payload.get("age_min"))
    age_max = live_data.parse_float(payload.get("age_max"))

    raw_page = payload.get("page") if isinstance(payload.get("page"), dict) else {}
    limit = max(1, min(live_data.parse_int(raw_page.get("limit") or payload.get("limit"), 100), 200))
    offset = max(0, live_data.parse_int(raw_page.get("offset") or payload.get("offset"), 0))

    raw_sort = payload.get("sort") if isinstance(payload.get("sort"), dict) else {}
    sort_key = _normalize_stat_key(raw_sort.get("key") or payload.get("sort_key") or "fantasy_points_ppr")
    sort_direction = str(raw_sort.get("direction") or payload.get("sort_direction") or "desc").strip().lower()
    sort_is_asc = sort_direction == "asc"
    sort_direction = "asc" if sort_is_asc else "desc"

    filters = _normalize_filters(payload.get("filters") if isinstance(payload.get("filters"), list) else [])

    raw_columns = payload.get("columns") if isinstance(payload.get("columns"), list) else []
    requested_metric_keys = _dedupe_metric_keys(
        ["fantasy_points_ppr", "age", "years_exp", *[entry["key"] for entry in filters], *raw_columns, sort_key]
    )

    null_fill = "9999999" if sort_is_asc else "-9999999"
    where_parts = ["1=1"]
    join_parts = ["LEFT JOIN player_latest_stats_current ls ON ls.player_id = p.player_id"]
    params: dict[str, object] = {"limit": limit, "offset": offset}

    for index, metric_filter in enumerate(filters):
        alias = f"mf{index}"
        clause, clause_params = _metric_filter_sql(alias, metric_filter)
        where_parts.append(
            f"""
            EXISTS (
              SELECT 1
              FROM player_latest_metrics {alias}
              WHERE {alias}.player_id = p.player_id
                AND {alias}.stat_key = :{alias}_key
                AND {clause}
            )
            """
        )
        params[f"{alias}_key"] = metric_filter["key"]
        params.update(clause_params)

    if sort_key in BASE_SORT_KEYS:
        sort_expr = BASE_SORT_KEYS[sort_key].format(null_fill=null_fill)
    else:
        sort_expr = f"COALESCE(msort.stat_value, COALESCE(ls.fantasy_points_ppr, {null_fill}))"
        join_parts.append("LEFT JOIN player_latest_metrics msort ON msort.player_id = p.player_id AND msort.stat_key = :sort_key")
        params["sort_key"] = sort_key

    if search:
        where_parts.append("(LOWER(p.full_name) LIKE :wild OR LOWER(p.first_name) LIKE :wild OR LOWER(p.last_name) LIKE :wild)")
        params["wild"] = f"%{search}%"
    if positions:
        placeholders = []
        for i, pos in enumerate(positions):
            key = f"position_{i}"
            placeholders.append(f":{key}")
            params[key] = pos
        where_parts.append(f"p.position IN ({','.join(placeholders)})")
    if team:
        where_parts.append("p.team = :team")
        params["team"] = team
    if age_min is not None:
        where_parts.append("p.age >= :age_min")
        params["age_min"] = age_min
    if age_max is not None:
        where_parts.append("p.age <= :age_max")
        params["age_max"] = age_max

    from_sql = f"FROM players p {' '.join(join_parts)}"
    where_sql = f"WHERE {' AND '.join(where_parts)}"

    total_row = connection.execute(
        text(f"SELECT COUNT(*) AS total {from_sql} {where_sql}"),
        params,
    ).mappings().first()
    total = int(total_row["total"] if total_row else 0)

    rows = connection.execute(
        text(
            f"""
            SELECT
              p.player_id, p.full_name, p.position, p.team, p.status, p.age, p.years_exp,
              ls.season AS latest_season,
              ls.week AS latest_week,
              ls.source AS latest_source,
              ls.fantasy_points_ppr AS latest_fantasy_points_ppr
            {from_sql}
            {where_sql}
            ORDER BY {sort_expr} {sort_direction.upper()}, p.full_name ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    items = [dict(row) for row in rows]
    player_ids = [item["player_id"] for item in items]

    metric_values: dict[str, dict[str, float]] = {player_id: {} for player_id in player_ids}
    if player_ids and requested_metric_keys:
        pid_placeholders = []
        key_placeholders = []
        metric_params: dict[str, object] = {}
        for index, player_id in enumerate(player_ids):
            name = f"pid_{index}"
            pid_placeholders.append(f":{name}")
            metric_params[name] = player_id
        for index, metric_key in enumerate(requested_metric_keys):
            name = f"mkey_{index}"
            key_placeholders.append(f":{name}")
            metric_params[name] = metric_key

        metric_rows = connection.execute(
            text(
                f"""
                SELECT player_id, stat_key, stat_value
                FROM player_latest_metrics
                WHERE player_id IN ({','.join(pid_placeholders)})
                  AND stat_key IN ({','.join(key_placeholders)})
                """
            ),
            metric_params,
        ).mappings().all()

        for row in metric_rows:
            metric_values.setdefault(str(row["player_id"]), {})[str(row["stat_key"])] = float(row["stat_value"])

    for item in items:
        item["metrics"] = metric_values.get(item["player_id"], {})

    return {
        "items": items,
        "page": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "has_next": offset + len(items) < total,
        },
        "sort": {
            "key": sort_key or "fantasy_points_ppr",
            "direction": sort_direction,
        },
        "applied_filters": filters,
        "columns": requested_metric_keys,
    }
