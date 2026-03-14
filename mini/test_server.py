import unittest
from server import find_shell_blocks, update_output_block

DOC = """\
# Hello

```sh
echo hi
```

Some text.

```bash
echo world
```
"""

DOC_WITH_OUTPUT = """\
# Hello

```sh
echo hi
```

```output
hi
```

```bash
echo world
```
"""


class TestFindShellBlocks(unittest.TestCase):
    def test_finds_two_blocks(self):
        blocks = find_shell_blocks(DOC)
        self.assertEqual(len(blocks), 2)

    def test_returns_match_objects(self):
        blocks = find_shell_blocks(DOC)
        self.assertIn('echo hi', blocks[0].group())
        self.assertIn('echo world', blocks[1].group())

    def test_skips_output_fences(self):
        blocks = find_shell_blocks(DOC_WITH_OUTPUT)
        self.assertEqual(len(blocks), 2)

    def test_empty_doc(self):
        self.assertEqual(find_shell_blocks("# No code here"), [])


class TestUpdateOutputBlock(unittest.TestCase):
    def test_insert_when_none_exists(self):
        result = update_output_block(DOC, 0, 'hi')
        self.assertIn('```output\nhi\n```', result)

    def test_replace_existing(self):
        result = update_output_block(DOC_WITH_OUTPUT, 0, 'new output')
        self.assertIn('```output\nnew output\n```', result)
        # Old output text must be gone
        self.assertEqual(result.count('```output'), 1)
        self.assertNotIn('\nhi\n', result.split('```output')[1].split('```')[0])

    def test_second_block_insert(self):
        result = update_output_block(DOC, 1, 'world')
        self.assertIn('```output\nworld\n```', result)
        # First block should be untouched
        self.assertNotIn('```output\nhi', result)

    def test_index_out_of_range(self):
        with self.assertRaises(ValueError):
            update_output_block(DOC, 99, 'x')


if __name__ == '__main__':
    unittest.main()
