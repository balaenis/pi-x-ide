local pi = require("pi_x_ide")

local function assert_equal(actual, expected, message)
  if actual ~= expected then
    error((message or "assertion failed") .. ": expected " .. vim.inspect(expected) .. ", got " .. vim.inspect(actual), 2)
  end
end

local function assert_truthy(value, message)
  if not value then
    error(message or "expected truthy value", 2)
  end
end

local function with_temp_file(lines)
  pi._test_reset()
  local root = vim.fn.tempname()
  vim.fn.mkdir(root .. "/src", "p")
  local file = root .. "/src/main.ts"
  vim.fn.writefile(lines, file)
  vim.cmd("cd " .. vim.fn.fnameescape(root))
  vim.cmd("edit " .. vim.fn.fnameescape(file))
  vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
  return root, file, vim.api.nvim_get_current_buf()
end

local root, file, buf = with_temp_file({ "hello world", "const x = 1;" })
local snapshot = pi.snapshot()
assert_truthy(snapshot, "snapshot should exist for file buffer")
assert_equal(snapshot.source, "nvim")
assert_equal(snapshot.filePath, file)
assert_equal(snapshot.workspaceFolder, root)
assert_equal(#snapshot.ranges, 0)
assert_equal(pi.format_range_mention(snapshot), "@src/main.ts")

vim.api.nvim_buf_set_mark(buf, "<", 1, 0, {})
vim.api.nvim_buf_set_mark(buf, ">", 1, 4, {})
pi._test_set_visual_mark_valid(true)
snapshot = pi.snapshot({ prefer_marks = true })
assert_equal(#snapshot.ranges, 1)
assert_equal(snapshot.ranges[1].text, "hello")
assert_equal(snapshot.ranges[1].selection.start.line, 0)
assert_equal(snapshot.ranges[1].selection.start.character, 0)
assert_equal(snapshot.ranges[1].selection["end"].character, 5)
assert_equal(pi.format_range_mention(snapshot), "@src/main.ts#L1")

root, file, buf = with_temp_file({ "你好🙂x" })
vim.api.nvim_buf_set_mark(buf, "<", 1, 0, {})
vim.api.nvim_buf_set_mark(buf, ">", 1, 6, {})
pi._test_set_visual_mark_valid(true)
snapshot = pi.snapshot({ prefer_marks = true })
assert_equal(snapshot.ranges[1].text, "你好🙂")
assert_equal(snapshot.ranges[1].selection["end"].character, 4)

local commands = vim.api.nvim_get_commands({ builtin = false })
assert_truthy(commands.PiXIdeStart, "PiXIdeStart command should be registered")
assert_truthy(commands.PiXIdeStop, "PiXIdeStop command should be registered")
assert_truthy(commands.PiXIdeStatus, "PiXIdeStatus command should be registered")
assert_truthy(commands.PiXIdeAttach, "PiXIdeAttach command should be registered")

pi._test_reset()
print("pi_x_ide nvim tests passed")
