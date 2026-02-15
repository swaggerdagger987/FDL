from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

import live_data

SORT_SQL = {
    "points_desc": "COALESCE(ls.fantasy_points_ppr, -9999999) DESC, p.full_name ASC",
    "points_asc": "COALESCE(ls.fantasy_points_ppr, 9999999) ASC, p.full_name ASC",
    "fantasy_points_ppr": "COALESCE(ls.fantasy_points_ppr, -9999999) DESC, p.full_name ASC",
    "fantasy_points_ppr_desc": "COALESCE(ls.fantasy_points_ppr, -9999999) DESC, p.full_name ASC",
    "fantasy_points_ppr_asc": "COALESCE(ls.fantasy_points_ppr, 9999999) ASC, p.full_name ASC",
    "name": "p.full_name ASC",
    "player_name": "p.full_name ASC",
    "team": "p.team ASC, p.full_name ASC",
    "age_desc": "COALESCE(p.age, -9999999) DESC, p.full_name ASC",
    "age_asc": "COALESCE(p.age, 9999999) ASC, p.full_name ASC",
}


def fetch_players(
    connection: Connection,
    *,
    search: str,
    position: str,
    team: str,
    limit: int,
    offset: int,
    sort: str,
) -> dict:
    search = (search or "").strip().lower()
    position = (position or "").strip().upper()
    team = (team or "").strip().upper()
    sort_sql = SORT_SQL.get((sort or "").strip().lower(), SORT_SQL["points_desc"])

    base_sql = """
      FROM players p
      LEFT JOIN player_latest_stats_current ls ON ls.player_id = p.player_id
      WHERE 1=1
    """
    where_sql = ""
    params: dict[str, object] = {"limit": limit, "offset": offset}
    if search:
        where_sql += " AND (LOWER(p.full_name) LIKE :wild OR LOWER(p.first_name) LIKE :wild OR LOWER(p.last_name) LIKE :wild)"
        params["wild"] = f"%{search}%"
    if position:
        where_sql += " AND p.position = :position"
        params["position"] = position
    if team:
        where_sql += " AND p.team = :team"
        params["team"] = team

    total_row = connection.execute(text(f"SELECT COUNT(*) AS total {base_sql} {where_sql}"), params).mappings().first()
    total = int(total_row["total"] if total_row else 0)

    sql = f"""
      SELECT
        p.player_id, p.full_name, p.first_name, p.last_name, p.position, p.team, p.status, p.age, p.years_exp,
        ls.season AS latest_season, ls.week AS latest_week, ls.source AS latest_source,
        ls.fantasy_points_ppr AS latest_fantasy_points_ppr
      {base_sql}
      {where_sql}
      ORDER BY {sort_sql}
      LIMIT :limit OFFSET :offset
    """
    rows = connection.execute(text(sql), params).mappings().all()
    items = [dict(row) for row in rows]
    return {
        "items": items,
        "page": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "has_next": offset + len(items) < total,
        },
    }


def fetch_filter_options(
    connection: Connection,
    *,
    search: str,
    position: str,
    team: str,
    limit: int,
) -> list[dict]:
    search = (search or "").strip().lower()
    position = (position or "").strip().upper()
    team = (team or "").strip().upper()

    sql = """
      SELECT
        plm.stat_key,
        COUNT(*) AS player_count,
        MIN(plm.stat_value) AS min_value,
        MAX(plm.stat_value) AS max_value
      FROM player_latest_metrics plm
      JOIN players p ON p.player_id = plm.player_id
      WHERE 1=1
    """

    params: dict[str, object] = {"limit": limit}

    if search:
        token = live_data.normalize_stat_key(search)
        wildcard = f"%{token.replace('_', '%') if token else search}%"
        if token == "yac":
            sql += " AND (plm.stat_key LIKE :wild1 OR plm.stat_key LIKE :wild2)"
            params["wild1"] = "%yac%"
            params["wild2"] = "%yards_after_catch%"
        else:
            sql += " AND plm.stat_key LIKE :wild"
            params["wild"] = wildcard

    if position:
        sql += " AND p.position = :position"
        params["position"] = position
    if team:
        sql += " AND p.team = :team"
        params["team"] = team

    sql += """
      GROUP BY plm.stat_key
      ORDER BY
        CASE plm.stat_key
          WHEN 'fantasy_points_ppr' THEN 0
          WHEN 'age' THEN 1
          WHEN 'years_exp' THEN 2
          ELSE 100
        END,
        plm.stat_key ASC
      LIMIT :limit
    """

    rows = connection.execute(text(sql), params).mappings().all()
    return [
        {
            "key": row["stat_key"],
            "label": live_data.build_stat_label(row["stat_key"]),
            "min_value": row["min_value"],
            "max_value": row["max_value"],
            "player_count": row["player_count"],
        }
        for row in rows
    ]
