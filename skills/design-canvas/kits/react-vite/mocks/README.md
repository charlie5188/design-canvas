Your own stand-ins for modules that cannot run on the canvas, such as a server-only data
client or a framework module the shell does not cover. Alias each in `vite.config.mts`
(`resolve.alias`). The shell's own stand-ins, in `canvas/stand-ins/`, cover Next.js and
React Router; an alias here for the same module wins over the shell's.
