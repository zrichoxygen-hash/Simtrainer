# SImventes - Dynamic Prompt System Implementation

## Current Status

✅ **Working**: HTTP Server, static files, /api/config, /api/prompts endpoints
⚠️ **Partial**: /api/chat endpoint (structure ready, agent pipeline needs testing)
🔲 **Not Yet Tested**: Real prompt loading from Supabase, agent orchestration

## Quick Start

### 1. Prerequisites
- Node.js 18+
- Environment variables in `.env` (already present):
  - `OPENAI_API_KEY` - OpenAI API key
  - `SUPABASE_MCP_AUTH` - Supabase authentication token  
  - `SUPABASE_MCP_URL` - Supabase MCP endpoint

### 2. Start the Server
```bash
cd /path/to/SImventes
node server.js
```

The server will start and report which port it's using (usually 3001 if 3000 is in use):
```
Server started: http://localhost:3001
PORT_INFO: 3001
```

### 3. Access the UI
Open: `http://localhost:3001`

The browser will automatically detect the server port.

## Architecture

### Backend (`server.js`)
- **GET /api/config** → Returns server configuration (`{ port: 3001 }`)
- **GET /api/prompts** → Returns list of available prompts
- **POST /api/chat** → Sends message, manages conversation
- **GET /** → Serves index.html and static files

### Frontend (`script.js`)
- **ChatAgent class** → Manages conversation state, prompt selection
- **discoverServerConfig()** → Auto-detects server port (handles conflicts)
- **loadPromptOptions()** → Fetches available prompts for dropdown
- **sendMessage()** → Sends message with promptId, conversationId, userId

### Workflow Engine (`workflow-sdk.mjs`)
- **listPromptOptions()** → Queries Supabase `promptid` table for active prompts
- **runWorkflow()** → Main orchestrator:
  1. Loads prompt config from Supabase
  2. Fetches/creates conversation log in `conversation_chat_logs` table  
  3. Runs Agent1 (simulateur) with injected stages/criteria
  4. If stage_complete: runs Evaluateur, appends evaluation to conversation
  5. If simulation_complete: finalizes transcript

## Current Implementation Status

### ✅ Complete
- [x] Port conflict handling with automatic fallback
- [x] Server auto-reports actual port to clients
- [x] Frontend auto-discovers server port at startup
- [x] Mock prompts endpoint working (for testing)
- [x] Zod schema fixes for OpenAI compatibility
- [x] Environment variable loading before module import

### ⚠️ In Progress
- [ ] Replace mock prompts with real Supabase queries
- [ ] Test /api/chat endpoint with full agent pipeline
- [ ] Verify conversation_chat_logs persistence
- [ ] Confirm stage evaluation accumulation
- [ ] Test transcript finalization

### 🔲 Not Yet Tested
- [ ] Real agent orchestration (Agent1 + Evaluateur + SqlExecutor)
- [ ] Multi-turn conversation handling
- [ ] Database row creation and updates
- [ ] Error handling for failed API calls

## Next Steps to Go Live

### Phase 1: Enable Real Prompt Loading
1. Edit `server.js`, uncomment real `listPromptOptions()` call:
```javascript
// Replace mock prompts with:
const prompts = await listPromptOptions();
```

2. Test /api/prompts returns real data from Supabase

### Phase 2: Test Chat Endpoint
1. Make POST to http://localhost:3001/api/chat:
```json
{
  "message": "Bonjour",
  "promptId": "prompt-001",
  "conversationId": null,
  "userId": "user@example.com",
  "conversationHistory": []
}
```

2. Verify response includes:
```json
{
  "response": "Agent reply...",
  "conversationId": "uuid-...",
  "promptId": "prompt-001",
  "stageName": "stage_name",
  "simulationComplete": false
}
```

### Phase 3: Database Validation
1. Check Supabase `conversation_chat_logs` table:
   - Row created with conversation_id, user_id, promptid
   - stage_evaluations array populated after each stage
   - full_conversation_transcript added when simulationComplete

## Troubleshooting

### Server won't start on port 3000
- Port 3000 is in use. Check: `lsof -i :3000` or wait for process to finish
- Server falls back to 3001 automatically ✓

### Frontend not loading prompts
- Browser console should show: "Detected server on port 3001"
- If not, check /api/prompts responds with status 200

### /api/chat times out
- Check OPENAI_API_KEY in .env is valid
- Verify SUPABASE_MCP credentials are correct
- Check network connectivity to OpenAI API

## File Reference

| File | Purpose | Status |
|------|---------|--------|
| `server.js` | HTTP server, endpoints | ✅ Ready |
| `script.js` | Frontend client | ✅ Ready |
| `index.html` | UI template | ✅ Ready |
| `styles.css` | Styling | ✅ Ready |
| `workflow-sdk.mjs` | Agent orchestration | ⚠️ Needs testing |
| `.env` | Credentials | ✅ Loaded |

## Testing Commands

```bash
# Test server config endpoint
node -e "import('http').then(http => { const req = http.default.request({hostname:'localhost',port:3001,path:'/api/config',method:'GET'}, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>console.log(d)); }); req.end(); })"

# Test prompts endpoint  
curl http://localhost:3001/api/prompts

# Check which port server is running on
lsof -i :3001
```

## Configuration

Edit `.env` to change:
- `PORT` - Default port to try (defaults to 3000, falls back through 3005)
- `OPENAI_API_KEY` - Your OpenAI API key
- `SUPABASE_MCP_AUTH` - Your Supabase token
- `SUPABASE_MCP_URL` - Supabase MCP endpoint

## Architecture Diagram

```
Browser (http://localhost:3001)
    ↓
script.js (ChatAgent class)
    ↓
{/api/prompts, /api/chat, /api/config}
    ↓
server.js (HTTP server)
    ↓
{workflow-sdk.mjs, .env credentials}
    ↓
OpenAI Agents SDK + Supabase MCP
    ↓
OpenAI API + Supabase Database
```

## Known Limitations

1. **Mock Prompts**: Currently returns hardcoded mock data. Need to enable Supabase queries.
2. **No Real Agent Pipeline**: Chat endpoint doesn't actually run agents yet. Need to test integration.
3. **No Database Persistence**: Conversation logs not being created in Supabase yet.

## Contact & Support

For issues with:
- **Port conflicts**: Check `lsof -i :3000` and `lsof -i :3001`
- **API keys**: Verify `.env` has valid OpenAI and Supabase credentials
- **Agent pipeline**: Check browser console and server logs for errors
