
# DPScript

DPScript, or The Minecraft Datapack scripting language, is a custom programming language designed specifically for generating custom Minecraft datapacks for creating custom behavior and mechanics.

The language uses files with extension `.dps`, and this extension for Visual Studio Code will automatically validate and autocomplete your code.

## Basic Datapack Tutorial

A dpscript file is used for creating datapacks, by translating readable code to the boilerplate known as `.mcfunction` files.

For example, here is a `.dps` file that will print to the chat "Hello World" every tick:

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

For a full documentation of the language, go to the [Wiki on GitHub](https://github.com/TheShinyBunny/DPScriptVSC/wiki)
