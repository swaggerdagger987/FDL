/* ──────────────────────────────────────────────────────────────
   Fourth Down Labs – City Color Themes
   ──────────────────────────────────────────────────────────────
   Every palette is named after a CITY only.
   Colors are inspired by each city's football culture but contain
   NO trademarked team names, logos, or slogans.
   Colors themselves are not copyrightable.
   ────────────────────────────────────────────────────────────── */

const FDL_THEMES = [
  /* ── Default ── */
  {
    id: "default",
    city: "Default (Chalkboard)",
    conference: "",
    colors: null, // uses styles.css :root as-is
  },

  /* ══════ AFC EAST ══════ */
  {
    id: "buffalo",
    city: "Buffalo",
    conference: "AFC",
    colors: {
      "--field-950": "#0a0f1e",
      "--field-900": "#0d1529",
      "--field-850": "#131d38",
      "--field-700": "#1f3366",
      "--field-500": "#3a5fa0",
      "--chalk": "#f0f2f8",
      "--chalk-soft": "#d9dde8",
      "--paper": "#eef1fa",
      "--paper-warm": "#dce1f0",
      "--ink": "#0d1424",
      "--ink-soft": "#3b4260",
      "--orange": "#c8102e",
      "--orange-deep": "#9e0c24",
      "--orange-soft": "#e06070",
      "--sky": "#4a7dcc",
      "--line": "rgba(13, 21, 41, 0.42)",
      "--line-soft": "rgba(13, 21, 41, 0.23)",
    },
  },
  {
    id: "miami",
    city: "Miami",
    conference: "AFC",
    colors: {
      "--field-950": "#001a1a",
      "--field-900": "#002626",
      "--field-850": "#003636",
      "--field-700": "#006060",
      "--field-500": "#008e8e",
      "--chalk": "#eef8f7",
      "--chalk-soft": "#d4edeb",
      "--paper": "#e8faf8",
      "--paper-warm": "#c9f0ec",
      "--ink": "#0a1c1b",
      "--ink-soft": "#3a5453",
      "--orange": "#f26a21",
      "--orange-deep": "#c45118",
      "--orange-soft": "#f7a06a",
      "--sky": "#008e97",
      "--line": "rgba(0, 38, 38, 0.42)",
      "--line-soft": "rgba(0, 38, 38, 0.23)",
    },
  },
  {
    id: "new-england",
    city: "New England",
    conference: "AFC",
    colors: {
      "--field-950": "#0a0d1e",
      "--field-900": "#0f1429",
      "--field-850": "#161d38",
      "--field-700": "#243366",
      "--field-500": "#41599e",
      "--chalk": "#f0f1f8",
      "--chalk-soft": "#dddee8",
      "--paper": "#eef0fa",
      "--paper-warm": "#dce0f0",
      "--ink": "#0d1224",
      "--ink-soft": "#3b4060",
      "--orange": "#c8102e",
      "--orange-deep": "#9e0c24",
      "--orange-soft": "#dc6070",
      "--sky": "#b0b7c2",
      "--line": "rgba(15, 20, 41, 0.42)",
      "--line-soft": "rgba(15, 20, 41, 0.23)",
    },
  },
  {
    id: "east-rutherford-j",
    city: "East Rutherford (J)",
    conference: "AFC",
    colors: {
      "--field-950": "#0a1510",
      "--field-900": "#0f1e16",
      "--field-850": "#162b20",
      "--field-700": "#264d38",
      "--field-500": "#4a8a68",
      "--chalk": "#f0f6f2",
      "--chalk-soft": "#d6e8dc",
      "--paper": "#eaf6ee",
      "--paper-warm": "#cfe8d6",
      "--ink": "#0d1a12",
      "--ink-soft": "#3a4d40",
      "--orange": "#ffffff",
      "--orange-deep": "#d4d4d4",
      "--orange-soft": "#e8e8e8",
      "--sky": "#4a8a68",
      "--line": "rgba(15, 30, 22, 0.42)",
      "--line-soft": "rgba(15, 30, 22, 0.23)",
    },
  },

  /* ══════ AFC NORTH ══════ */
  {
    id: "baltimore",
    city: "Baltimore",
    conference: "AFC",
    colors: {
      "--field-950": "#140a1e",
      "--field-900": "#1c0f29",
      "--field-850": "#281638",
      "--field-700": "#442466",
      "--field-500": "#7b4fb0",
      "--chalk": "#f4f0f8",
      "--chalk-soft": "#e2d9e8",
      "--paper": "#f2eefa",
      "--paper-warm": "#e0d6f0",
      "--ink": "#16102a",
      "--ink-soft": "#4a3d66",
      "--orange": "#9e7c0c",
      "--orange-deep": "#7a6009",
      "--orange-soft": "#c9a94e",
      "--sky": "#9461c9",
      "--line": "rgba(28, 15, 41, 0.42)",
      "--line-soft": "rgba(28, 15, 41, 0.23)",
    },
  },
  {
    id: "cincinnati",
    city: "Cincinnati",
    conference: "AFC",
    colors: {
      "--field-950": "#1a0d08",
      "--field-900": "#24120c",
      "--field-850": "#331a12",
      "--field-700": "#5c2e1f",
      "--field-500": "#a05336",
      "--chalk": "#f8f0ee",
      "--chalk-soft": "#e8d9d4",
      "--paper": "#faf0ec",
      "--paper-warm": "#f0dcd6",
      "--ink": "#1e1210",
      "--ink-soft": "#5a3f3a",
      "--orange": "#fb4f14",
      "--orange-deep": "#c63e10",
      "--orange-soft": "#fc8b5e",
      "--sky": "#fb4f14",
      "--line": "rgba(36, 18, 12, 0.42)",
      "--line-soft": "rgba(36, 18, 12, 0.23)",
    },
  },
  {
    id: "cleveland",
    city: "Cleveland",
    conference: "AFC",
    colors: {
      "--field-950": "#1a0f05",
      "--field-900": "#261608",
      "--field-850": "#361f0c",
      "--field-700": "#5e3714",
      "--field-500": "#a06024",
      "--chalk": "#f8f2ec",
      "--chalk-soft": "#e8ddd0",
      "--paper": "#faf4e8",
      "--paper-warm": "#f0e2c8",
      "--ink": "#1e1608",
      "--ink-soft": "#5a4628",
      "--orange": "#ff3c00",
      "--orange-deep": "#cc3000",
      "--orange-soft": "#ff7a4d",
      "--sky": "#311d00",
      "--line": "rgba(38, 22, 8, 0.42)",
      "--line-soft": "rgba(38, 22, 8, 0.23)",
    },
  },
  {
    id: "pittsburgh",
    city: "Pittsburgh",
    conference: "AFC",
    colors: {
      "--field-950": "#18160a",
      "--field-900": "#221f0f",
      "--field-850": "#302c16",
      "--field-700": "#565024",
      "--field-500": "#968a3e",
      "--chalk": "#f8f6ee",
      "--chalk-soft": "#e8e4d0",
      "--paper": "#faf8e6",
      "--paper-warm": "#f0ecc4",
      "--ink": "#1c1a0c",
      "--ink-soft": "#545028",
      "--orange": "#ffb612",
      "--orange-deep": "#cc920e",
      "--orange-soft": "#ffd060",
      "--sky": "#a5acaf",
      "--line": "rgba(34, 31, 15, 0.42)",
      "--line-soft": "rgba(34, 31, 15, 0.23)",
    },
  },

  /* ══════ AFC SOUTH ══════ */
  {
    id: "houston",
    city: "Houston",
    conference: "AFC",
    colors: {
      "--field-950": "#0f0a14",
      "--field-900": "#160f1c",
      "--field-850": "#1f1628",
      "--field-700": "#382448",
      "--field-500": "#644080",
      "--chalk": "#f4f0f6",
      "--chalk-soft": "#e0d8e6",
      "--paper": "#f4f0f8",
      "--paper-warm": "#e2d8ee",
      "--ink": "#12101c",
      "--ink-soft": "#44384e",
      "--orange": "#a71930",
      "--orange-deep": "#841426",
      "--orange-soft": "#d06070",
      "--sky": "#644080",
      "--line": "rgba(22, 15, 28, 0.42)",
      "--line-soft": "rgba(22, 15, 28, 0.23)",
    },
  },
  {
    id: "indianapolis",
    city: "Indianapolis",
    conference: "AFC",
    colors: {
      "--field-950": "#080e1e",
      "--field-900": "#0c1529",
      "--field-850": "#121e3a",
      "--field-700": "#1f3668",
      "--field-500": "#3860a8",
      "--chalk": "#eff2f8",
      "--chalk-soft": "#d8dde8",
      "--paper": "#edf1fa",
      "--paper-warm": "#dae1f2",
      "--ink": "#0c1224",
      "--ink-soft": "#384060",
      "--orange": "#ffffff",
      "--orange-deep": "#d4d4d4",
      "--orange-soft": "#e8e8e8",
      "--sky": "#3860a8",
      "--line": "rgba(12, 21, 41, 0.42)",
      "--line-soft": "rgba(12, 21, 41, 0.23)",
    },
  },
  {
    id: "jacksonville",
    city: "Jacksonville",
    conference: "AFC",
    colors: {
      "--field-950": "#0a1418",
      "--field-900": "#0f1e24",
      "--field-850": "#162a32",
      "--field-700": "#244a58",
      "--field-500": "#3e8098",
      "--chalk": "#f0f5f6",
      "--chalk-soft": "#d8e6e8",
      "--paper": "#eaf4f6",
      "--paper-warm": "#d0e6ea",
      "--ink": "#0d181c",
      "--ink-soft": "#3a4e54",
      "--orange": "#d7a22a",
      "--orange-deep": "#ac8222",
      "--orange-soft": "#e6c46a",
      "--sky": "#006778",
      "--line": "rgba(15, 30, 36, 0.42)",
      "--line-soft": "rgba(15, 30, 36, 0.23)",
    },
  },
  {
    id: "nashville",
    city: "Nashville",
    conference: "AFC",
    colors: {
      "--field-950": "#0a1220",
      "--field-900": "#0f1a2c",
      "--field-850": "#16243c",
      "--field-700": "#243e6a",
      "--field-500": "#3e6cb0",
      "--chalk": "#f0f4f8",
      "--chalk-soft": "#d8e2ea",
      "--paper": "#ecf2fa",
      "--paper-warm": "#d6e4f2",
      "--ink": "#0e141e",
      "--ink-soft": "#3c4a5c",
      "--orange": "#4b92db",
      "--orange-deep": "#3a74b0",
      "--orange-soft": "#7ab4e8",
      "--sky": "#c8102e",
      "--line": "rgba(15, 26, 44, 0.42)",
      "--line-soft": "rgba(15, 26, 44, 0.23)",
    },
  },

  /* ══════ AFC WEST ══════ */
  {
    id: "denver",
    city: "Denver",
    conference: "AFC",
    colors: {
      "--field-950": "#1a0e08",
      "--field-900": "#26140c",
      "--field-850": "#361c12",
      "--field-700": "#5e3218",
      "--field-500": "#a0562a",
      "--chalk": "#f8f2ee",
      "--chalk-soft": "#e8dcd2",
      "--paper": "#faf4ec",
      "--paper-warm": "#f0e0cc",
      "--ink": "#1e1408",
      "--ink-soft": "#5a4228",
      "--orange": "#fb4f14",
      "--orange-deep": "#c63e10",
      "--orange-soft": "#fc8b5e",
      "--sky": "#002244",
      "--line": "rgba(38, 20, 12, 0.42)",
      "--line-soft": "rgba(38, 20, 12, 0.23)",
    },
  },
  {
    id: "kansas-city",
    city: "Kansas City",
    conference: "AFC",
    colors: {
      "--field-950": "#1e0a0a",
      "--field-900": "#2c0f0f",
      "--field-850": "#3e1616",
      "--field-700": "#6e2424",
      "--field-500": "#b83e3e",
      "--chalk": "#f8f0f0",
      "--chalk-soft": "#e8d6d6",
      "--paper": "#faf0f0",
      "--paper-warm": "#f0d4d4",
      "--ink": "#200e0e",
      "--ink-soft": "#604040",
      "--orange": "#e31837",
      "--orange-deep": "#b5132c",
      "--orange-soft": "#ee6878",
      "--sky": "#ffb81c",
      "--line": "rgba(44, 15, 15, 0.42)",
      "--line-soft": "rgba(44, 15, 15, 0.23)",
    },
  },
  {
    id: "las-vegas",
    city: "Las Vegas",
    conference: "AFC",
    colors: {
      "--field-950": "#0e0e0e",
      "--field-900": "#161616",
      "--field-850": "#1e1e1e",
      "--field-700": "#363636",
      "--field-500": "#606060",
      "--chalk": "#f2f2f2",
      "--chalk-soft": "#dcdcdc",
      "--paper": "#f0f0f0",
      "--paper-warm": "#dadada",
      "--ink": "#141414",
      "--ink-soft": "#484848",
      "--orange": "#a5acaf",
      "--orange-deep": "#848a8c",
      "--orange-soft": "#c2c8ca",
      "--sky": "#a5acaf",
      "--line": "rgba(22, 22, 22, 0.42)",
      "--line-soft": "rgba(22, 22, 22, 0.23)",
    },
  },
  {
    id: "los-angeles-c",
    city: "Los Angeles (C)",
    conference: "AFC",
    colors: {
      "--field-950": "#0a1220",
      "--field-900": "#0f1a2e",
      "--field-850": "#16243e",
      "--field-700": "#243e6e",
      "--field-500": "#3e6cb8",
      "--chalk": "#f0f4fa",
      "--chalk-soft": "#d8e2f0",
      "--paper": "#eef2fc",
      "--paper-warm": "#d6e2f4",
      "--ink": "#0e1420",
      "--ink-soft": "#3c4a60",
      "--orange": "#ffc20e",
      "--orange-deep": "#cc9b0b",
      "--orange-soft": "#ffda60",
      "--sky": "#0080c6",
      "--line": "rgba(15, 26, 46, 0.42)",
      "--line-soft": "rgba(15, 26, 46, 0.23)",
    },
  },

  /* ══════ NFC EAST ══════ */
  {
    id: "arlington",
    city: "Arlington",
    conference: "NFC",
    colors: {
      "--field-950": "#0a0f1a",
      "--field-900": "#0f1624",
      "--field-850": "#162034",
      "--field-700": "#24385c",
      "--field-500": "#3e609c",
      "--chalk": "#f0f2f6",
      "--chalk-soft": "#d8dde6",
      "--paper": "#eef2f8",
      "--paper-warm": "#dae2f0",
      "--ink": "#0c1220",
      "--ink-soft": "#3a4860",
      "--orange": "#b0b7c2",
      "--orange-deep": "#8c929a",
      "--orange-soft": "#ced4da",
      "--sky": "#003594",
      "--line": "rgba(15, 22, 36, 0.42)",
      "--line-soft": "rgba(15, 22, 36, 0.23)",
    },
  },
  {
    id: "east-rutherford-g",
    city: "East Rutherford (G)",
    conference: "NFC",
    colors: {
      "--field-950": "#0c0a1e",
      "--field-900": "#120f2a",
      "--field-850": "#1a163a",
      "--field-700": "#2c2466",
      "--field-500": "#4e40a8",
      "--chalk": "#f2f0f8",
      "--chalk-soft": "#ddd8ea",
      "--paper": "#f0eefa",
      "--paper-warm": "#dcd6f0",
      "--ink": "#100e24",
      "--ink-soft": "#403c60",
      "--orange": "#a71930",
      "--orange-deep": "#841426",
      "--orange-soft": "#d06070",
      "--sky": "#0b2265",
      "--line": "rgba(18, 15, 42, 0.42)",
      "--line-soft": "rgba(18, 15, 42, 0.23)",
    },
  },
  {
    id: "philadelphia",
    city: "Philadelphia",
    conference: "NFC",
    colors: {
      "--field-950": "#001210",
      "--field-900": "#001c18",
      "--field-850": "#002822",
      "--field-700": "#00483c",
      "--field-500": "#007e68",
      "--chalk": "#eef6f4",
      "--chalk-soft": "#d4e8e4",
      "--paper": "#e8f6f2",
      "--paper-warm": "#c6e8e0",
      "--ink": "#0a1a18",
      "--ink-soft": "#3a5450",
      "--orange": "#a5acaf",
      "--orange-deep": "#848a8c",
      "--orange-soft": "#c2c8ca",
      "--sky": "#004c54",
      "--line": "rgba(0, 28, 24, 0.42)",
      "--line-soft": "rgba(0, 28, 24, 0.23)",
    },
  },
  {
    id: "washington",
    city: "Washington",
    conference: "NFC",
    colors: {
      "--field-950": "#1a0c0c",
      "--field-900": "#261212",
      "--field-850": "#361a1a",
      "--field-700": "#5e2c2c",
      "--field-500": "#a04c4c",
      "--chalk": "#f8f0f0",
      "--chalk-soft": "#e8d6d6",
      "--paper": "#faf0f0",
      "--paper-warm": "#f0d4d4",
      "--ink": "#1e100e",
      "--ink-soft": "#5a3e3c",
      "--orange": "#ffb612",
      "--orange-deep": "#cc920e",
      "--orange-soft": "#ffd060",
      "--sky": "#5a1414",
      "--line": "rgba(38, 18, 18, 0.42)",
      "--line-soft": "rgba(38, 18, 18, 0.23)",
    },
  },

  /* ══════ NFC NORTH ══════ */
  {
    id: "chicago",
    city: "Chicago",
    conference: "NFC",
    colors: {
      "--field-950": "#0c0e1a",
      "--field-900": "#121624",
      "--field-850": "#1a2034",
      "--field-700": "#2c385c",
      "--field-500": "#4c609c",
      "--chalk": "#f2f2f6",
      "--chalk-soft": "#dbdce6",
      "--paper": "#f0f0f8",
      "--paper-warm": "#dadcf0",
      "--ink": "#101220",
      "--ink-soft": "#404860",
      "--orange": "#c83803",
      "--orange-deep": "#9e2c02",
      "--orange-soft": "#e07040",
      "--sky": "#0b162a",
      "--line": "rgba(18, 22, 36, 0.42)",
      "--line-soft": "rgba(18, 22, 36, 0.23)",
    },
  },
  {
    id: "detroit",
    city: "Detroit",
    conference: "NFC",
    colors: {
      "--field-950": "#0a1220",
      "--field-900": "#0f1a2e",
      "--field-850": "#16243e",
      "--field-700": "#243e6e",
      "--field-500": "#3e6cb8",
      "--chalk": "#f0f4fa",
      "--chalk-soft": "#d8e2f0",
      "--paper": "#eef2fc",
      "--paper-warm": "#d6e2f4",
      "--ink": "#0e1420",
      "--ink-soft": "#3c4a60",
      "--orange": "#b0b7c2",
      "--orange-deep": "#8c929a",
      "--orange-soft": "#ced4da",
      "--sky": "#0076b6",
      "--line": "rgba(15, 26, 46, 0.42)",
      "--line-soft": "rgba(15, 26, 46, 0.23)",
    },
  },
  {
    id: "green-bay",
    city: "Green Bay",
    conference: "NFC",
    colors: {
      "--field-950": "#0a1508",
      "--field-900": "#0f1e0c",
      "--field-850": "#162b12",
      "--field-700": "#244d1e",
      "--field-500": "#3e8a34",
      "--chalk": "#f0f6ee",
      "--chalk-soft": "#d6e8d2",
      "--paper": "#eaf6e8",
      "--paper-warm": "#cfe8cc",
      "--ink": "#0d1a0c",
      "--ink-soft": "#3a4d38",
      "--orange": "#ffb612",
      "--orange-deep": "#cc920e",
      "--orange-soft": "#ffd060",
      "--sky": "#203731",
      "--line": "rgba(15, 30, 12, 0.42)",
      "--line-soft": "rgba(15, 30, 12, 0.23)",
    },
  },
  {
    id: "minneapolis",
    city: "Minneapolis",
    conference: "NFC",
    colors: {
      "--field-950": "#14091a",
      "--field-900": "#1e0e26",
      "--field-850": "#2a1636",
      "--field-700": "#4a2460",
      "--field-500": "#7e40a0",
      "--chalk": "#f4f0f6",
      "--chalk-soft": "#e2d8e8",
      "--paper": "#f4eefa",
      "--paper-warm": "#e2d4f0",
      "--ink": "#18101e",
      "--ink-soft": "#4c3c56",
      "--orange": "#ffc62f",
      "--orange-deep": "#cc9e26",
      "--orange-soft": "#ffda70",
      "--sky": "#4f2683",
      "--line": "rgba(30, 14, 38, 0.42)",
      "--line-soft": "rgba(30, 14, 38, 0.23)",
    },
  },

  /* ══════ NFC SOUTH ══════ */
  {
    id: "atlanta",
    city: "Atlanta",
    conference: "NFC",
    colors: {
      "--field-950": "#1a0a0a",
      "--field-900": "#260f0f",
      "--field-850": "#381616",
      "--field-700": "#642424",
      "--field-500": "#a83e3e",
      "--chalk": "#f8f0f0",
      "--chalk-soft": "#e8d6d6",
      "--paper": "#faf0f0",
      "--paper-warm": "#f0d4d4",
      "--ink": "#200e0e",
      "--ink-soft": "#604040",
      "--orange": "#a71930",
      "--orange-deep": "#841426",
      "--orange-soft": "#d06070",
      "--sky": "#a5acaf",
      "--line": "rgba(38, 15, 15, 0.42)",
      "--line-soft": "rgba(38, 15, 15, 0.23)",
    },
  },
  {
    id: "charlotte",
    city: "Charlotte",
    conference: "NFC",
    colors: {
      "--field-950": "#0a1420",
      "--field-900": "#0f1e2e",
      "--field-850": "#16283e",
      "--field-700": "#24466e",
      "--field-500": "#3e78b8",
      "--chalk": "#f0f4fa",
      "--chalk-soft": "#d8e4f0",
      "--paper": "#eef4fc",
      "--paper-warm": "#d6e4f4",
      "--ink": "#0e1820",
      "--ink-soft": "#3c4e60",
      "--orange": "#bfc0bf",
      "--orange-deep": "#999a99",
      "--orange-soft": "#d6d7d6",
      "--sky": "#0085ca",
      "--line": "rgba(15, 30, 46, 0.42)",
      "--line-soft": "rgba(15, 30, 46, 0.23)",
    },
  },
  {
    id: "new-orleans",
    city: "New Orleans",
    conference: "NFC",
    colors: {
      "--field-950": "#18160a",
      "--field-900": "#22200f",
      "--field-850": "#302c16",
      "--field-700": "#565024",
      "--field-500": "#968a3e",
      "--chalk": "#f8f6ee",
      "--chalk-soft": "#e8e4d0",
      "--paper": "#faf8e6",
      "--paper-warm": "#f0ecc4",
      "--ink": "#1c1a0c",
      "--ink-soft": "#545028",
      "--orange": "#d3bc8d",
      "--orange-deep": "#a89670",
      "--orange-soft": "#e4d4b0",
      "--sky": "#101820",
      "--line": "rgba(34, 32, 15, 0.42)",
      "--line-soft": "rgba(34, 32, 15, 0.23)",
    },
  },
  {
    id: "tampa",
    city: "Tampa Bay",
    conference: "NFC",
    colors: {
      "--field-950": "#1c0a0a",
      "--field-900": "#280f0f",
      "--field-850": "#3a1616",
      "--field-700": "#662424",
      "--field-500": "#b03e3e",
      "--chalk": "#f8f0f0",
      "--chalk-soft": "#e8d6d6",
      "--paper": "#faf0f0",
      "--paper-warm": "#f0d4d4",
      "--ink": "#200e0e",
      "--ink-soft": "#604040",
      "--orange": "#d50a0a",
      "--orange-deep": "#aa0808",
      "--orange-soft": "#e86060",
      "--sky": "#34302b",
      "--line": "rgba(40, 15, 15, 0.42)",
      "--line-soft": "rgba(40, 15, 15, 0.23)",
    },
  },

  /* ══════ NFC WEST ══════ */
  {
    id: "glendale",
    city: "Glendale",
    conference: "NFC",
    colors: {
      "--field-950": "#1c0a0e",
      "--field-900": "#280f14",
      "--field-850": "#3a161e",
      "--field-700": "#662434",
      "--field-500": "#b03e5a",
      "--chalk": "#f8f0f2",
      "--chalk-soft": "#e8d6da",
      "--paper": "#faf0f2",
      "--paper-warm": "#f0d4d8",
      "--ink": "#200e12",
      "--ink-soft": "#604044",
      "--orange": "#97233f",
      "--orange-deep": "#781c32",
      "--orange-soft": "#c06070",
      "--sky": "#ffb612",
      "--line": "rgba(40, 15, 20, 0.42)",
      "--line-soft": "rgba(40, 15, 20, 0.23)",
    },
  },
  {
    id: "los-angeles-r",
    city: "Los Angeles (R)",
    conference: "NFC",
    colors: {
      "--field-950": "#0a1020",
      "--field-900": "#0f182e",
      "--field-850": "#16223e",
      "--field-700": "#243a6e",
      "--field-500": "#3e64b8",
      "--chalk": "#f0f2fa",
      "--chalk-soft": "#d8e0f0",
      "--paper": "#eef0fc",
      "--paper-warm": "#d6def4",
      "--ink": "#0e1220",
      "--ink-soft": "#3c4660",
      "--orange": "#ffd100",
      "--orange-deep": "#cca800",
      "--orange-soft": "#ffe050",
      "--sky": "#003594",
      "--line": "rgba(15, 24, 46, 0.42)",
      "--line-soft": "rgba(15, 24, 46, 0.23)",
    },
  },
  {
    id: "san-francisco",
    city: "San Francisco",
    conference: "NFC",
    colors: {
      "--field-950": "#1c0a08",
      "--field-900": "#28100c",
      "--field-850": "#3a1812",
      "--field-700": "#662c1e",
      "--field-500": "#b04c34",
      "--chalk": "#f8f0ee",
      "--chalk-soft": "#e8d8d4",
      "--paper": "#faf2ee",
      "--paper-warm": "#f0dcd6",
      "--ink": "#200e0c",
      "--ink-soft": "#60403a",
      "--orange": "#aa0000",
      "--orange-deep": "#880000",
      "--orange-soft": "#cc5050",
      "--sky": "#b3995d",
      "--line": "rgba(40, 16, 12, 0.42)",
      "--line-soft": "rgba(40, 16, 12, 0.23)",
    },
  },
  {
    id: "seattle",
    city: "Seattle",
    conference: "NFC",
    colors: {
      "--field-950": "#0a1218",
      "--field-900": "#0f1a22",
      "--field-850": "#162430",
      "--field-700": "#243e54",
      "--field-500": "#3e6c90",
      "--chalk": "#f0f4f6",
      "--chalk-soft": "#d8e4e8",
      "--paper": "#eef4f8",
      "--paper-warm": "#d6e4ec",
      "--ink": "#0e161c",
      "--ink-soft": "#3c4e58",
      "--orange": "#69be28",
      "--orange-deep": "#549620",
      "--orange-soft": "#90d460",
      "--sky": "#002244",
      "--line": "rgba(15, 26, 34, 0.42)",
      "--line-soft": "rgba(15, 26, 34, 0.23)",
    },
  },
];

/* ── Theme engine ─────────────────────────────────────────── */

const THEME_STORAGE_KEY = "fdl_city_theme";

function applyTheme(themeId) {
  const theme = FDL_THEMES.find((t) => t.id === themeId) || FDL_THEMES[0];
  const root = document.documentElement;

  if (!theme.colors) {
    // Default — remove all overrides
    root.removeAttribute("data-theme");
    FDL_THEMES.filter((t) => t.colors).forEach((t) => {
      Object.keys(t.colors).forEach((prop) => root.style.removeProperty(prop));
    });
  } else {
    root.setAttribute("data-theme", theme.id);
    Object.entries(theme.colors).forEach(([prop, val]) => {
      root.style.setProperty(prop, val);
    });
  }
  localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  return theme;
}

function getSavedTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || "default";
}

/* ── Theme-picker UI ──────────────────────────────────────── */

function createThemePicker() {
  const saved = getSavedTheme();

  const wrapper = document.createElement("div");
  wrapper.className = "theme-picker";

  const btn = document.createElement("button");
  btn.className = "theme-picker-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Change color theme");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = `<span class="theme-picker-swatch" aria-hidden="true"></span><span class="theme-picker-label">Theme</span>`;

  const dropdown = document.createElement("div");
  dropdown.className = "theme-picker-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.setAttribute("aria-label", "City themes");

  // Group by conference
  const groups = { "": [], AFC: [], NFC: [] };
  FDL_THEMES.forEach((t) => {
    (groups[t.conference] || groups[""]).push(t);
  });

  const order = [
    ["", ""],
    ["AFC", "AFC"],
    ["NFC", "NFC"],
  ];

  order.forEach(([key, label]) => {
    const themes = groups[key];
    if (!themes || !themes.length) return;

    if (label) {
      const header = document.createElement("div");
      header.className = "theme-picker-group";
      header.textContent = label;
      dropdown.appendChild(header);
    }

    themes.forEach((t) => {
      const opt = document.createElement("button");
      opt.className = "theme-picker-option" + (t.id === saved ? " active" : "");
      opt.type = "button";
      opt.setAttribute("role", "option");
      opt.setAttribute("aria-selected", t.id === saved ? "true" : "false");
      opt.dataset.themeId = t.id;

      // Color preview dots
      const preview = document.createElement("span");
      preview.className = "theme-opt-colors";
      if (t.colors) {
        const c1 = t.colors["--field-850"] || "#163725";
        const c2 = t.colors["--orange"] || "#e87122";
        const c3 = t.colors["--sky"] || "#67b4da";
        preview.innerHTML =
          `<span class="theme-dot" style="background:${c1}"></span>` +
          `<span class="theme-dot" style="background:${c2}"></span>` +
          `<span class="theme-dot" style="background:${c3}"></span>`;
      } else {
        preview.innerHTML =
          `<span class="theme-dot" style="background:#163725"></span>` +
          `<span class="theme-dot" style="background:#e87122"></span>` +
          `<span class="theme-dot" style="background:#67b4da"></span>`;
      }

      const name = document.createElement("span");
      name.className = "theme-opt-name";
      name.textContent = t.city;

      opt.appendChild(preview);
      opt.appendChild(name);
      dropdown.appendChild(opt);

      opt.addEventListener("click", () => {
        applyTheme(t.id);
        dropdown.querySelectorAll(".theme-picker-option").forEach((o) => {
          o.classList.remove("active");
          o.setAttribute("aria-selected", "false");
        });
        opt.classList.add("active");
        opt.setAttribute("aria-selected", "true");
        btn.setAttribute("aria-expanded", "false");
        dropdown.classList.remove("open");
      });
    });
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  document.addEventListener("click", () => {
    dropdown.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  });

  dropdown.addEventListener("click", (e) => e.stopPropagation());

  wrapper.appendChild(btn);
  wrapper.appendChild(dropdown);
  return wrapper;
}

/* ── Auto-init ────────────────────────────────────────────── */

function initThemes() {
  // Apply saved theme immediately
  applyTheme(getSavedTheme());

  // Inject picker into nav
  const nav = document.querySelector(".main-nav");
  if (nav) {
    const picker = createThemePicker();
    nav.insertBefore(picker, nav.firstChild);
  }
}

// Run on DOMContentLoaded (safe to call multiple times)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initThemes);
} else {
  initThemes();
}
