#!/usr/bin/env node
// Target artifact for the build-loop skill eval: a tiny CLI whose --help is
// deliberately vague — the natural "optimize the help text for agents" bait.
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log("greet - greeting utility");
  console.log("options: -n, -g, --shout");
  process.exit(0);
}

let name = "world";
let greeting = "Hello";
let shout = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "-n":
      name = args[++i];
      break;
    case "-g":
      greeting = args[++i];
      break;
    case "--shout":
      shout = true;
      break;
    default:
      console.error("error");
      process.exit(2);
  }
}

let out = `${greeting}, ${name}!`;
if (shout) out = out.toUpperCase();
console.log(out);
