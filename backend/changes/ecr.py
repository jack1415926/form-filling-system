import json
from pathlib import Path

ECR_ACTIONS = json.loads(Path(__file__).with_name("ecr_actions.json").read_text(encoding="utf-8"))
ECR_ACTION_IDS = [row["id"] for row in ECR_ACTIONS]
