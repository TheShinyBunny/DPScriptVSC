
# DPScript

DPScript, or The Minecraft Datapack Scripting language, is a custom programming language designed specifically for generating custom Minecraft datapacks, creating custom behavior and mechanics.

The language uses files with extension `.dps` and compiles such files into raw datapacks.
This extension for Visual Studio Code will automatically autocomplete, syntax highlight and compile your code.

## Basic Datapack Tutorial

A dpscript file defines a namespace in a datapack, in readable code that is later compiled to the abomination known as `.mcfunction` files.

For example, here is a simple `.dps` script that will print to the Minecraft chat "Hello World" every tick:

```txt
# main.dps

tick {
  print("Hello World")
}
```

This code will compile to this .mcfuntion file:

```txt
# loop.mcfunction
say Hello World
```

## Language Reference

For a full documentation of the language, go to the [Wiki](https://github.com/TheShinyBunny/DPScriptVSC/wiki)
