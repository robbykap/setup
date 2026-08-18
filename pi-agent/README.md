# pi-agent

Contents of `~/.pi/agent`. Install by symlinking this directory:

```sh
ln -s "$(pwd)/pi-agent" ~/.pi/agent
cd ~/.pi/agent && npm install
```

If `~/.pi/agent` already exists, move it aside first.

## Extensions

- `extensions/tasks` — task dashboard for background processes and shell
  commands. Open with `/tasks` or `alt+t`.

### tasks

Open with `/tasks` or `alt+t`.

Dashboard: `j`/`k` select · `enter` inspect · `x` kill · `f` filter · `esc` close
Detail: `j`/`k` scroll · `g`/`G` top/bottom · `t` stdout/stderr · `x` kill ·
`s` send to agent · `y` copy · `esc` back

Agent tools: `bg_start`, `bg_status`, `bg_list`, `bg_kill`. At most 8 background
tasks run at once; all of them are killed when the session ends.

The agent's own `bash` calls and your `!` commands appear in the list too, as
read-only entries: Pi owns those processes, so they cannot be killed from here
and their output is a single merged stream.
