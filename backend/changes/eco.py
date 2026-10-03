import json
from pathlib import Path

ECO_ACTIONS = json.loads(Path(__file__).with_name("eco_actions.json").read_text(encoding="utf-8"))
ECO_ACTION_IDS = [row["id"] for row in ECO_ACTIONS]
