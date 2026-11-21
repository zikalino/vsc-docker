import { DefinitionLoader } from './definitionLoader';

console.log("Validation...");

var loader = new DefinitionLoader("./", "defs/____tree.yaml");
var templates = loader.getYaml();

if (templates === null) {
  var errors = loader.getErrors();

  for (var i = 0; i < errors.length; i++) {
    console.log(errors[i]);
  }

  console.log("** TOTAL ERRORS: " + errors.length);
  
  process.exit(1);
}