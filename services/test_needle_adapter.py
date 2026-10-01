import unittest

from needle_adapter import valid_schema


class SchemaValidationTests(unittest.TestCase):
    def test_accepts_bounded_object_schema(self):
        self.assertTrue(valid_schema({
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
            "additionalProperties": False,
        }))

    def test_rejects_non_object_or_missing_schema(self):
        for schema in (None, [], "object", {"type": "array"}, {}):
            with self.subTest(schema=schema):
                self.assertFalse(valid_schema(schema))

    def test_rejects_oversized_schema(self):
        self.assertFalse(valid_schema({
            "type": "object",
            "description": "x" * 5000,
        }))

    def test_rejects_non_json_schema_values(self):
        self.assertFalse(valid_schema({"type": "object", "value": object()}))

    def test_rejects_deeply_nested_schema_without_raising(self):
        schema = {"type": "object"}
        current = schema
        for _ in range(1500):
            child = {}
            current["child"] = child
            current = child
        self.assertFalse(valid_schema(schema))


if __name__ == "__main__":
    unittest.main()
