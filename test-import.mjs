import { listPromptOptions, runWorkflow } from './workflow-sdk.mjs';

console.log('Starting import test...');

try {
  console.log('Checking if listPromptOptions is callable...');
  console.log(typeof listPromptOptions);
  
  console.log('Calling listPromptOptions()...');
  const prompts = await listPromptOptions();
  console.log('Success!');
  console.log(JSON.stringify(prompts, null, 2));
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
