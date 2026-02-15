from __future__ import annotations

import os

import uvicorn


if __name__ == "__main__":
    host = os.getenv("FDL_V2_HOST", "127.0.0.1")
    port = int(os.getenv("FDL_V2_PORT", os.getenv("PORT", "8010")))
    uvicorn.run("src.backend.main:app", host=host, port=port, reload=os.getenv("FDL_V2_RELOAD", "0") == "1")
