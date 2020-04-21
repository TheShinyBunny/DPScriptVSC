
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

Full documentation of the language.

### Global Statements

The following statements are used in the outer scope of the file, outside of any function blocks.

#### tick

```txt
tick {
    <code>
}
```

A function block that executes every server tick, at the very start of the tick.

#### const

`const <name> = <value>`

Defines a constant score value to be used in the code. Useful for a number that appears multiple times in the code or a way to easily find & tweak configuration.
Stored in a generated `Consts` scoreboard.

#### global

`global <name>`

Defines a global score that is used without an entity to store it. This entry is stored in a generated `Global` scoreboard under the variable's name.

### Basic Statements

Statements that are used inside a `function`, `load` or `tick` blocks.

#### print

`print <message>`

Sends a message in the chat to all players.

### Block Command - NOT IMPLEMENTED

`block[<pos>]`

Access the block in the specified position.

### Possible Commands

#### spawnLoot

#### set

`block[here] = <block>[[<state>]][{<nbt>}]`

Sets the block at that location to another block

* `block`: The block ID to set
* `state`: Optional block properties, for example `stone_slab[half=bottom]`
* `nbt`: Optional NBT for tile entities, for example `barrel{Items:[{id:"diamond_sword",Count:1}]}`

#### slot

#### break

### Selectors

In minecraft commands, entity selectors are used to select and target entities in the world using various filters. In dpscript, this had been made a lot easier using some cool shorthands.

For instance, if you want to select the closest 5 creepers, in minecaft it'll be `@e[type=creeper,sort=nearest,limit=5]`, but in DPScript it'll be `@creeper[nearest*5]`.

A selector is declared starting with a `@`, following by either a vanilla target (`@a`, `@e`, `@s`, etc.) or a minecraft entity type id: (`creeper`, `skeleton`, `armor_stand`, etc.). Following that, is an optional selector parameters defined inside square brackets like so:

`@creeper[<args>]`

The selectors have many methods and fields, like `@e.kill()`, `@a[tag=new].title("Hello!")` etc. Here is a full documentation of them:

### Selector Members

#### effect

`@e.effect(<effect>)`

Gives a status effect to the entity.

`effect`: The effect to give: [syntax](#effect-syntax)

`@e.cure(*)`

Clears all effects from the entity

`@e.cure(<effectID>)`

Clears the specified effect from the entity.

`effectID`: The minecraft ID of the effect. Aliases are allowed, like `regen` or `fire_res`.

#### grant/revoke

`@a.grant(*)`

Grants or revokes all advancements for the player

`@a.grant(from <advancement>)`

Grants or revokes all advancements in a tree starting from the specified advancement.

* `advancement`: The start advancement ID

`@a.grant(until <advancement>)`

Grants or revokes all advancements starting from a root advancement all the way down the path to the specified one.

* `advancement`: The target advancement ID

`@a.grant(through <advancement>)`

Grants or revokes all advancements starting from a root advancement, through the specified one, and all of its children.

* `advancement`: The target advancement ID

`@a.revoke(<advancement>[.<criterion>])`

Grants or revokes a single advancement

* `advancement`: The advancement ID to grant/revoke.
* `criterion`: An optional criterion name to only grant/revoke it, rather than the whole advancement.

*Example*: `@a.grant(from minecraft:story/mine_stone)`

### Effect Syntax

`<effectID> [<tier>] [for <duration>] [hide]`

* `effectID`: The minecraft ID of the effect. Aliases are allowed, like `regen` or `fire_res`.
* `tier`: Optional effect amplifier, for stronger effects. Can be any number, and 0 means tier 1, 1 means tier 2, etc. You can also use roman numbers, as such that I is tier 1, IV is tier 4. If omitted, defaults to tier 1.
* `duration`: The duration the status effect will last. You can use any combination of numbers followed by unit character. Examples: `5s` = 5 seconds, `10mins 15s` = 10 minutes and 15 seconds, `100` = 100 seconds.
* `hide`: Add the `hide` keyword at the end to disable effect particles.
