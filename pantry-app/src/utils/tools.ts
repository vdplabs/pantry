export interface ToolDefinition {
  id: string;
  name: string;
  label: string;
  description: string;
  schema: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
      };
    };
  };
}

export const PRESET_TOOLS: ToolDefinition[] = [
  {
    id: 'fetch_weather',
    name: 'fetch_weather',
    label: '⛅ Weather',
    description: 'Fetch current weather and temperature for any city',
    schema: {
      type: 'function',
      function: {
        name: 'fetch_weather',
        description: 'Fetch current weather conditions and temperature for a given city',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'The city name (e.g., Tokyo, San Francisco, London)',
            },
            units: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: 'Temperature units (celsius or fahrenheit)',
            },
          },
          required: ['city', 'units'],
        },
      },
    },
  },
  {
    id: 'get_stock_price',
    name: 'get_stock_price',
    label: '📈 Stocks',
    description: 'Fetch real-time stock quotes, volume, and daily change',
    schema: {
      type: 'function',
      function: {
        name: 'get_stock_price',
        description: 'Get real-time stock market quote and financial data for a ticker symbol',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'The stock ticker symbol (e.g., AAPL, MSFT, GOOG, TSLA)',
            },
          },
          required: ['symbol'],
        },
      },
    },
  },
  {
    id: 'calculate',
    name: 'calculate',
    label: '🧮 Calculator',
    description: 'Evaluate exact mathematical expressions and formulas',
    schema: {
      type: 'function',
      function: {
        name: 'calculate',
        description: 'Evaluate mathematical expressions accurately',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'The mathematical expression to evaluate (e.g., "24 * 1.08 + sqrt(144)")',
            },
          },
          required: ['expression'],
        },
      },
    },
  },
];

export function executeMockTool(name: string, args: Record<string, any>): Record<string, any> {
  if (name === 'fetch_weather') {
    const city = args.city || 'Unknown Location';
    const isFahr = (args.units || '').toLowerCase().includes('fahr');
    return {
      status: 'success',
      city,
      temperature: isFahr ? 72 : 22,
      units: isFahr ? 'fahrenheit' : 'celsius',
      condition: 'Partly Cloudy',
      humidity: '48%',
      wind_speed: isFahr ? '9 mph' : '14 km/h',
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'get_stock_price') {
    const symbol = (args.symbol || 'AAPL').toUpperCase();
    const mockPrices: Record<string, number> = {
      AAPL: 232.45,
      MSFT: 448.20,
      GOOG: 182.15,
      TSLA: 248.80,
      NVDA: 128.90,
      AMZN: 186.50,
    };
    const price = mockPrices[symbol] || 150.0;
    return {
      status: 'success',
      symbol,
      price,
      currency: 'USD',
      change_percent: '+1.45%',
      volume: '42.8M',
      market_state: 'Regular Trading',
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'calculate') {
    try {
      // Safe arithmetic evaluation for standard math expressions
      const sanitized = (args.expression || '').replace(/[^0-9+\-*/().%^e ]/gi, '');
      // eslint-disable-next-line no-eval
      const result = Function(`"use strict"; return (${sanitized.replace(/\^/g, '**')})`)();
      return {
        status: 'success',
        expression: args.expression,
        result,
      };
    } catch (err: any) {
      return {
        status: 'error',
        expression: args.expression,
        error: err.message || 'Could not evaluate expression',
      };
    }
  }

  return {
    status: 'success',
    tool: name,
    args,
    result: 'Executed successfully',
  };
}
