<img src="assets/icon.svg" width="64" height="64" alt="">

# heimdall

![license](https://img.shields.io/badge/license-MIT-blue)
![status](https://img.shields.io/badge/status-early-yellow)

a watchman for your context switches. heimdall keeps the day's tasks, takes a tick every time you switch to one, and draws you a map of where your attention actually went.

because a paper notebook can count the ticks, but it can't tell you that tuesday was 41 switches and a headache.

## the idea

every morning you build the day's board. you carry over what's still open from yesterday, pull in long-running tasks, and add new ones. through the day, you tap whatever you just switched to. that's the whole ritual.

heimdall turns the taps into a ribbon of your day. it counts the switches, keeps deadlines in sight right when you're about to jump to something else, and lets you jot down how the day felt: stress, strain, headaches, whether you cried or laughed. over weeks, the two sit next to each other, so you can see what's been wearing you down.

it nudges, it never scolds. there are no streaks to break and no red failure states.

## what counts as a switch

multitasking is the hard part of a notebook. when you bounce between two things fast enough, ticking every bounce is silly, and ticking once is a lie. heimdall's answer:

- **focus** is what you're holding right now. one task, a few tasks, rest, or nothing at all.
- **tap** a task to make it your focus. **hold** a task to add it to what you're already holding. holding two or more is a **juggle**.
- a **switch** is a moment something new enters your head. bouncing inside a juggle isn't counted bounce by bounce. it shows up as juggle time instead, which is its own kind of strain.
- a **tick** is still the notebook's unit: one tap on a task. per-task ticks sit right where you're used to them.

| you go from | to | is it a switch? |
| ----------- | -- | --------------- |
| a | b | yes |
| a | a and b | yes, b came in |
| a and b | b | no, you only let go of a |
| a | rest, then a | no, you came back |
| a | rest, then b | yes, once |

a day starts at 04:00, not midnight, so a switch at 01:30 still belongs to the day you were actually living.

## status

early. the plan is a sveltekit pwa that works offline, a small rust server that syncs it between your devices, and a nix flake that builds and deploys both.

## license

MIT
