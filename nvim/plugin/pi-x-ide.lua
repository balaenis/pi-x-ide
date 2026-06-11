if vim.g.loaded_pi_x_ide == 1 then
  return
end
vim.g.loaded_pi_x_ide = 1

local function command(name, fn)
  pcall(vim.api.nvim_create_user_command, name, function()
    require("pi_x_ide")[fn]()
  end, {})
end

command("PiXIdeStart", "start")
command("PiXIdeStop", "stop")
command("PiXIdeStatus", "status")
command("PiXIdeAttach", "attach")
