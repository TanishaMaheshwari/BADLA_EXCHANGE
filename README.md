# Badla Calculator

A comprehensive toolkit for calculating Badla values for various financial instruments across multiple exchanges (MCX, COMEX, DGCX).

## Overview

The Badla Calculator provides tools to calculate arbitrage opportunities between different exchanges for commodities like GOLD, SILVER, CRUDE, COPPER, and GAS. It processes JSON data files containing instrument information and calculates Badla values (BUY, SELL, LTP) based on specified equations.

## Features

- **Multiple Interfaces**: Command-line, web-based, and programmatic interfaces
- **Filtering**: Filter results by Badla type (GOLD, SILVER, etc.)
- **Sorting**: Sort results by different fields (name, type, buy, sell, ltp)
- **Output Formats**: View results as tables, JSON, or CSV
- **Detailed Information**: View detailed exchange data and calculations

## Calculation Logic

The Badla values are calculated using the following approach:

1. **Data Extraction**: Extract prices from MCX, COMEX, and DGCX exchanges
2. **DGCX Price Conversion**: Convert DGCX prices using the formula `10000 / price` to align with the expected format
3. **Equation Evaluation**: 
   - Replace variables in the equation (L1, L2, L3, D1) with actual prices
   - L1 = COMEX price
   - L2 = MCX price
   - L3 = Converted DGCX price (10000/price)
   - D1 = Duty value
4. **Final Calculation**:
   - For LTP: Uses last prices from all exchanges
   - For BUY: Uses COMEX sell price, MCX buy price, and DGCX sell price (all converted appropriately)
   - For SELL: Uses COMEX buy price, MCX sell price, and DGCX buy price (all converted appropriately)
5. **Reverse Logic**: If the reverse flag is set to "1", the calculation is reversed

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```

## Usage

### Command-line Interface

```bash
# Basic usage
node badla_calculator_cli.js

# Filter by type
node badla_calculator_cli.js --type GOLD

# Change output format
node badla_calculator_cli.js --output json
node badla_calculator_cli.js --output csv

# Sort results
node badla_calculator_cli.js --sort buy

# Process specific file
node badla_calculator_cli.js --file GOLD_6__COMEXJUNE_MCXJUNE__MARCHDG.json

# Show help
node badla_calculator_cli.js --help
```

### Web Interface

```bash
# Start the web server
npm start

# Then open in browser
# http://localhost:3000
```

### Programmatic Usage

```javascript
const { calculateBadla } = require('./badla_calculator');

// Load your data
const data = require('./data/GOLD_6__COMEXJUNE_MCXJUNE__MARCHDG.json');

// Calculate Badla values
const result = calculateBadla(data);
console.log(result);
```

### Shell Script (Unix/Linux/Mac)

```bash
# Make the script executable
chmod +x badla.sh

# Run the script
./badla.sh

# Show help
./badla.sh --help
```

### Batch File (Windows)

```
badla.bat
```

## Data Directory

Place your JSON data files in the `data` directory. The files should follow the format shown in the example files.

## Scripts

The package.json includes several scripts for convenience:

- `npm start`: Start the web server
- `npm run calc`: Run the calculator with default settings
- `npm run cli`: Run the CLI version
- `npm run all`: Run all tools in sequence

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- This calculator is designed to work with the data format from the LivebadlaComponent
- Special thanks to the trading community for their input on Badla calculations 