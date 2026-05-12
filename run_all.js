#!/usr/bin/env node

/**
 * Run All Badla Calculator Tools
 * 
 * This script runs all three Badla calculator tools in sequence:
 * 1. Basic calculator (badla_calculator.js)
 * 2. CLI calculator with different outputs (badla_calculator_cli.js)
 * 3. Web interface (badla_web.js)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const RESULTS_DIR = path.join(__dirname, 'results');
const TYPES = ['GOLD', 'SILVER', 'CRUDE', 'COPPER', 'GAS'];
const WEB_PORT = process.env.PORT || 3000;

// Create results directory if it doesn't exist
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR);
}

// Function to run a command and capture output
function runCommand(command, args, outputFile = null) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);
    
    const proc = spawn(command, args);
    let output = '';
    
    proc.stdout.on('data', (data) => {
      const dataStr = data.toString();
      output += dataStr;
      process.stdout.write(dataStr);
    });
    
    proc.stderr.on('data', (data) => {
      process.stderr.write(data.toString());
    });
    
    proc.on('close', (code) => {
      console.log(`Command exited with code ${code}`);
      
      if (outputFile) {
        fs.writeFileSync(outputFile, output);
        console.log(`Output saved to ${outputFile}`);
      }
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
  });
}

// Main function to run all tools
async function runAllTools() {
  try {
    console.log('=== RUNNING BADLA CALCULATOR TOOLS ===\n');
    
    // Step 1: Run basic calculator
    console.log('\n=== STEP 1: Running Basic Calculator ===\n');
    await runCommand('node', ['badla_calculator.js']);
    
    // Step 2: Run CLI calculator with different outputs
    console.log('\n=== STEP 2: Running CLI Calculator with Different Outputs ===\n');
    
    // Run for each type
    for (const type of TYPES) {
      console.log(`\n--- Processing ${type} ---\n`);
      
      // Table output
      await runCommand(
        'node', 
        ['badla_calculator_cli.js', '--type', type], 
        path.join(RESULTS_DIR, `${type.toLowerCase()}_table.txt`)
      );
      
      // JSON output
      await runCommand(
        'node', 
        ['badla_calculator_cli.js', '--type', type, '--output', 'json'], 
        path.join(RESULTS_DIR, `${type.toLowerCase()}.json`)
      );
      
      // CSV output
      await runCommand(
        'node', 
        ['badla_calculator_cli.js', '--type', type, '--output', 'csv'], 
        path.join(RESULTS_DIR, `${type.toLowerCase()}.csv`)
      );
    }
    
    // Step 3: Start web interface
    console.log('\n=== STEP 3: Starting Web Interface ===\n');
    console.log(`Web interface will be available at http://localhost:${WEB_PORT}`);
    console.log('Press Ctrl+C to stop the web server\n');
    
    // This will keep running until manually stopped
    await runCommand('node', ['badla_web.js']);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
runAllTools(); 