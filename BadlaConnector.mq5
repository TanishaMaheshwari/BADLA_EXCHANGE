//+------------------------------------------------------------------+
//|                                               BadlaConnector.mq5 |
//|                                  Copyright 2026, Badla Arbitrage  |
//|                                             https://badla.board  |
//|                                                                  |
//| Drop this EA on the chart of the symbol you want to trade.       |
//| Enable WebRequests for: http://localhost:3000 (or your VPS IP)   |
//| Go to Tools -> Options -> Expert Advisors -> Allow WebRequest   |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, Badla Arbitrage"
#property link      "https://badla.board"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//--- inputs
input string   ServerUrl       = "http://160.250.204.114:3000"; // Badla Server Base URL
input string   BrokerName      = "targetfx";            // Display Name for Broker
input double   MaxLotsAllowed  = 10.0;                    // Max lots headroom limit
input int      PollIntervalSec = 1;                       // Polling interval in seconds

CTrade trade;
string account_id;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   account_id = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   Print("BadlaConnector initialized. Account ID: ", account_id, " Broker: ", BrokerName);

   EventSetTimer(PollIntervalSec);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
//| Timer function                                                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   PollServer();
}

//+------------------------------------------------------------------+
//| Build a clean char[] payload for WebRequest, no null terminator  |
//+------------------------------------------------------------------+
void BuildPostData(string payload, char &post_data[])
{
   int len = StringToCharArray(payload, post_data, 0, StringLen(payload));
   ArrayResize(post_data, len);
}

//+------------------------------------------------------------------+
//| Poll server for heartbeats and orders                            |
//+------------------------------------------------------------------+
void PollServer()
{
   // Gather active positions for lot used
   double lotUsed = 0.0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      if(PositionGetSymbol(i) == _Symbol)
      {
         lotUsed += PositionGetDouble(POSITION_VOLUME);
      }
   }

   double lotHeadroom = MaxLotsAllowed - lotUsed;
   if(lotHeadroom < 0) lotHeadroom = 0;

   bool marketOpen = (SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_DISABLED);
   bool symbolValid = true; // since it is running on this chart

   // Create heartbeat JSON payload
   string payload = StringFormat(
      "{\"accountId\":\"%s\",\"brokerName\":\"%s\",\"exchange\":\"%s\",\"symbol\":\"%s\","
      "\"symbolValid\":%s,\"marketOpen\":%s,\"lotUsed\":%.2f,\"lotMax\":%.2f,\"lotHeadroom\":%.2f,\"error\":\"\"}",
      JsonEscape(account_id), JsonEscape(BrokerName), JsonEscape(_Symbol), JsonEscape(_Symbol),
      symbolValid ? "true" : "false", marketOpen ? "true" : "false",
      lotUsed, MaxLotsAllowed, lotHeadroom
   );

   char post_data[];
   BuildPostData(payload, post_data);

   uchar result[];
   string result_headers;
   string url = ServerUrl + "/api/ea/heartbeat?format=csv";

   string headers = "Content-Type: application/json\r\nAccept: text/plain\r\n";

   ResetLastError();
   int res = WebRequest("POST", url, headers, 3000, post_data, result, result_headers);

   if(res == -1)
   {
      Print("WebRequest failed. Error code: ", GetLastError());
      return;
   }

   if(res != 200)
   {
      Print("Server returned error code: ", res);
      return;
   }

   string response = CharArrayToString(result);
   if(StringLen(response) == 0) return;

   // Process response lines
   string lines[];
   ushort u_sep = StringGetCharacter("\n", 0);
   int line_count = StringSplit(response, u_sep, lines);

   for(int i = 0; i < line_count; i++)
   {
      string line = lines[i];
      StringTrimLeft(line);
      StringTrimRight(line);

      if(StringFind(line, "order:") == 0)
      {
         ProcessOrder(line);
      }
   }
}

//+------------------------------------------------------------------+
//| Process order line: order:id,symbol,action,lots                  |
//+------------------------------------------------------------------+
void ProcessOrder(string line)
{
   // Strip "order:" prefix
   string data_str = StringSubstr(line, 6);

   string fields[];
   ushort u_sep = StringGetCharacter(",", 0);
   int field_count = StringSplit(data_str, u_sep, fields);

   if(field_count < 4)
   {
      Print("Invalid order line: ", line);
      return;
   }

   int order_id = (int)StringToInteger(fields[0]);
   string symbol = fields[1];
   string action = fields[2];
   double lots = StringToDouble(fields[3]);

   Print("Executing order #", order_id, ": ", action, " ", lots, " ", symbol);

   bool success = false;
   ulong ticket = 0;
   double exec_price = 0.0;
   string error_msg = "";

   if(action == "BUY")
   {
      success = trade.Buy(lots, symbol);
   }
   else if(action == "SELL")
   {
      success = trade.Sell(lots, symbol);
   }
   else
   {
      error_msg = "Unknown action: " + action;
      Print(error_msg);
   }

   if(success)
   {
      ticket = trade.ResultDeal();
      if(ticket == 0) ticket = trade.ResultOrder();
      exec_price = trade.ResultPrice();
      Print("Order #", order_id, " executed successfully. Ticket: ", ticket, " Price: ", exec_price);
   }
   else
   {
      error_msg = IntegerToString(trade.ResultRetcode()) + ": " + trade.ResultComment();
      Print("Order #", order_id, " execution failed: ", error_msg);
   }

   // Send report to server
   SendReport(order_id, success, ticket, exec_price, error_msg);
}

//+------------------------------------------------------------------+
//| Send execution report back to server                            |
//+------------------------------------------------------------------+
void SendReport(int order_id, bool success, ulong ticket, double price, string error_msg)
{
   string payload = StringFormat(
      "{\"accountId\":\"%s\",\"orderId\":%d,\"success\":%s,\"ticket\":\"%s\",\"price\":%f,\"error\":\"%s\"}",
      account_id, order_id, success ? "true" : "false", IntegerToString(ticket), price, JsonEscape(error_msg)
   );

   char post_data[];
   BuildPostData(payload, post_data);

   uchar result[];
   string result_headers;
   string url = ServerUrl + "/api/ea/report";
   string headers = "Content-Type: application/json\r\n";

   ResetLastError();
   int res = WebRequest("POST", url, headers, 3000, post_data, result, result_headers);
   if(res != 200)
   {
      Print("Failed to send execution report. HTTP code: ", res, " Error code: ", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| Escape a string for safe JSON embedding                          |
//+------------------------------------------------------------------+
string JsonEscape(string s)
{
   string result = s;
   StringReplace(result, "\\", "\\\\");
   StringReplace(result, "\"", "\\\"");
   return result;
}