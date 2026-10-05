import json
from pathlib import Path

DEFINITION = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
CHART_IDS = [row['id'] for row in DEFINITION['charts']]
QUESTION_IDS = [row['id'] for row in DEFINITION['questions']]
F_VALUES = ['', *[option['value'] for option in DEFINITION['f_options']]]
FINAL_VALUES = ['', 'significant', 'non_significant']
RESULT_VALUES = ['', 'not_applicable', 'significant', 'continue', 'non_significant']
