"""Check that the development plan can be executed against the current PRD."""

from decimal import Decimal
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
TASK_ID = re.compile(r"T\d{2}")
ACCEPTANCE_ID = re.compile(r"[A-Z]+-\d{2}")


def table_rows(text):
    return [
        [cell.strip() for cell in line.strip().strip("|").split("|")]
        for line in text.splitlines()
        if line.startswith("| ")
    ]


class DevelopmentPlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = (ROOT / "DEVELOPMENT_PLAN.md").read_text(encoding="utf-8")
        cls.prd = (ROOT / "PRD.md").read_text(encoding="utf-8")
        cls.rows = table_rows(cls.plan)
        cls.tasks = [row for row in cls.rows if TASK_ID.fullmatch(row[0])]
        cls.coverage = [
            row for row in cls.rows if ACCEPTANCE_ID.fullmatch(row[0])
        ]

    def test_tasks_have_unique_ids_and_actionable_details(self):
        task_ids = [row[0] for row in self.tasks]
        self.assertTrue(task_ids)
        self.assertEqual(len(task_ids), len(set(task_ids)))
        headings = re.findall(r"^### (T\d{2}) .+$", self.plan, re.MULTILINE)
        self.assertCountEqual(task_ids, headings)
        for task_id in task_ids:
            with self.subTest(task=task_id):
                section = re.search(
                    rf"^### {task_id} .*?$(.*?)(?=^### |^## |\Z)",
                    self.plan,
                    re.MULTILINE | re.DOTALL,
                )
                self.assertIsNotNone(section)
                self.assertIn("完成证明", section.group(1))
                self.assertGreaterEqual(section.group(1).count("\n- "), 4)

    def test_dependencies_form_an_executable_order(self):
        positions = {row[0]: index for index, row in enumerate(self.tasks)}
        for row in self.tasks:
            self.assertEqual(len(row), 5)
            for dependency in TASK_ID.findall(row[2]):
                with self.subTest(task=row[0], dependency=dependency):
                    self.assertIn(dependency, positions)
                    self.assertLess(positions[dependency], positions[row[0]])

    def test_acceptance_matrix_covers_current_prd_once(self):
        expected = [
            row[0]
            for row in table_rows(self.prd)
            if ACCEPTANCE_ID.fullmatch(row[0])
        ]
        actual = [row[0] for row in self.coverage]
        self.assertTrue(expected)
        self.assertEqual(len(actual), len(set(actual)))
        self.assertCountEqual(expected, actual)
        known_tasks = {row[0] for row in self.tasks}
        for row in self.coverage:
            with self.subTest(criterion=row[0]):
                self.assertEqual(len(row), 4)
                for column in (row[1], row[2]):
                    references = TASK_ID.findall(column)
                    self.assertTrue(references)
                    self.assertTrue(set(references).issubset(known_tasks))
                self.assertTrue(row[3])

    def test_milestone_effort_matches_tasks_and_total(self):
        effort_by_milestone = {}
        for task in self.tasks:
            effort = Decimal(task[3])
            self.assertGreater(effort, 0)
            effort_by_milestone[task[4]] = (
                effort_by_milestone.get(task[4], Decimal(0)) + effort
            )
        milestones = [row for row in self.rows if re.fullmatch(r"M\d+", row[0])]
        self.assertCountEqual(effort_by_milestone, [row[0] for row in milestones])
        cumulative = Decimal(0)
        for row in milestones:
            with self.subTest(milestone=row[0]):
                self.assertEqual(Decimal(row[2]), effort_by_milestone[row[0]])
                cumulative += Decimal(row[2])
                self.assertEqual(Decimal(row[3]), cumulative)
        stated_total = re.search(r"基准合计 (\d+(?:\.\d+)?) 人日", self.plan)
        self.assertIsNotNone(stated_total)
        self.assertEqual(cumulative, Decimal(stated_total.group(1)))


if __name__ == "__main__":
    unittest.main()
