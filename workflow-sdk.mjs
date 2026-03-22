import { hostedMcpTool, Agent, Runner, withTrace } from "@openai/agents";
import { z } from "zod";

const SUPABASE_MCP_AUTH = process.env.SUPABASE_MCP_AUTH || "";
const SUPABASE_MCP_URL = process.env.SUPABASE_MCP_URL || "";

const mcp = hostedMcpTool({
  serverLabel: "supa",
  allowedTools: ["execute_sql"],
  headers: {
    Authorization: `Bearer ${SUPABASE_MCP_AUTH}`
  },
  requireApproval: "never",
  serverUrl: SUPABASE_MCP_URL
});

const Agent1Schema = z.object({
  client_reply: z.string(),
  intervention_increment: z.number(),
  off_topic_increment: z.number(),
  difficulty_delta: z.number(),
  stage_complete: z.boolean()
});

const EvaluateurSchema = z.object({
  evaluation: z.object({
    stage_index: z.number(),
    stage_name: z.string(),
    scores: z.array(
      z.object({
        critere: z.string(),
        note: z.number().nullable(),
        feedback: z.string()
      })
    ),
    overall_weighted_score: z.number(),
    next_difficulty_suggestion: z.string(),
    summary_feedback: z.string()
  })
});

const SqlExecutorSchema = z.object({
  status: z.string(),
  rows_json: z.string(),
  error: z.string().nullable()
});

function sqlEscape(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function sqlNullableString(value) {
  if (value === null || value === undefined || value === "") {
    return "NULL";
  }
  return `'${sqlEscape(value)}'`;
}

function sqlJson(value) {
  return `'${sqlEscape(JSON.stringify(value ?? null))}'::jsonb`;
}

function parseMaybeJson(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const attempts = [trimmed, trimmed.replace(/^"|"$/g, "")];

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") {
        try {
          return JSON.parse(parsed);
        } catch {
          return parsed;
        }
      }
      return parsed;
    } catch {
      // continue
    }
  }

  return fallback;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

function countUserTurns(transcript) {
  const txt = String(transcript || "");
  const matches = txt.match(/(^|\n)User:/g);
  return matches ? matches.length : 0;
}

function requireFinalOutput(result) {
  if (!result.finalOutput) {
    throw new Error("Agent result is undefined");
  }

  return {
    output_text: JSON.stringify(result.finalOutput),
    output_parsed: result.finalOutput
  };
}

function buildCriteriaPrompt(criteria) {
  const normalized = toArray(criteria);
  if (!normalized.length) {
    return "[]";
  }

  return normalized
    .map((item, index) => {
      const nom = item?.nom || item?.critere || `Critere ${index + 1}`;
      const coefficient = item?.coefficient ?? item?.weight ?? 1;
      return `${index + 1}. ${nom} (coefficient=${coefficient})`;
    })
    .join("\n");
}

const agent1Instructions = (runContext) => {
  const {
    stateCurrentStageName,
    stateCurrentStageIndex,
    stateCurrentDifficultyLevel,
    stateStageTranscript,
    workflowInputAsText,
    stateConversationId,
    statePromptSystem,
    statePromptMessages,
    stateStages,
    stateCriteria
  } = runContext.context;

  const criteriaAsText = buildCriteriaPrompt(stateCriteria);

  return `${statePromptSystem || ""}\n\n${statePromptMessages || ""}\n\nTu es un simulateur d'entretien de vente avance.

Tu incarnes exclusivement un prospect realiste dans une interaction commerciale.
Tu ne joues jamais le role du formateur, de l'evaluateur ou de l'assistant.
Tu restes strictement dans ton personnage du debut a la fin.

Contexte dynamique:
- Conversation: ${stateConversationId}
- Etapes configurees: ${JSON.stringify(stateStages || [])}
- Etape actuelle: ${stateCurrentStageName}
- Index etape: ${stateCurrentStageIndex}
- Criteres a tester: ${criteriaAsText}
- Difficulte: ${stateCurrentDifficultyLevel}
- Transcript etape: ${stateStageTranscript}
- Dernier message etudiant: ${workflowInputAsText}

Tu dois repondre uniquement avec un JSON strict conforme au schema:
{
  "client_reply": "<string>",
  "intervention_increment": <0 ou 1>,
  "off_topic_increment": <0 ou 1>,
  "difficulty_delta": <-1, 0 ou 1>,
  "stage_complete": <true ou false>
}

Rappels stricts:
- Aucun texte hors JSON.
- Reponse client realiste et breve (1 a 3 phrases).
- Oriente tes reponses pour permettre de tester les criteres de l'etape courante.
- stage_complete=true seulement si l'objectif de l'etape est atteint.`;
};

const evaluateurInstructions = (runContext) => {
  const {
    stateCurrentStageName,
    stateCurrentStageIndex,
    stateCurrentDifficultyLevel,
    stateStageTranscript,
    stateCriteria,
    statePromptEvaluateur
  } = runContext.context;

  const criteriaAsText = buildCriteriaPrompt(stateCriteria);

  return `${statePromptEvaluateur || ""}

Tu es un evaluateur expert d'entretien de vente.
Tu evalues uniquement l'etape qui vient de se terminer.

Contexte:
- Etape: ${stateCurrentStageName}
- Index: ${stateCurrentStageIndex}
- Difficulte: ${stateCurrentDifficultyLevel}
- Transcript etape: ${stateStageTranscript}
- Criteres: ${criteriaAsText}

Regles:
- N'invente rien.
- Note chaque critere seulement s'il est observable.
- Si non observable, note=null et feedback="".
- Retourne uniquement un JSON strict.

Format obligatoire:
{
  "evaluation": {
    "stage_index": <number>,
    "stage_name": "<string>",
    "scores": [
      {
        "critere": "<string>",
        "note": <number or null>,
        "feedback": "<string>"
      }
    ],
    "overall_weighted_score": <number>,
    "next_difficulty_suggestion": "increase|maintain|decrease",
    "summary_feedback": "<string>"
  }
}`;
};

const sqlExecutorInstructions = (runContext) => {
  const { sqlQuery } = runContext.context;
  return `Tu es un agent technique Supabase.

Utilise uniquement execute_sql sur le projet nbkwndncydoyuwutkjzy.
Fais un seul appel outil, en executant exactement cette requete SQL:

${sqlQuery}

Retourne uniquement un JSON strict:
{
  "status": "OK",
  "rows_json": "<JSON.stringify(tableau_des_rows)>",
  "error": null
}

Si erreur SQL:
{
  "status": "ERROR",
  "rows_json": "[]",
  "error": "<message>"
}`;
};

const agent1 = new Agent({
  name: "Agent1",
  instructions: agent1Instructions,
  model: "gpt-4.1",
  tools: [mcp],
  outputType: Agent1Schema,
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2000,
    store: true
  }
});

const evaluateur = new Agent({
  name: "Evaluateur",
  instructions: evaluateurInstructions,
  model: "gpt-5-nano",
  tools: [mcp],
  outputType: EvaluateurSchema,
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});

const sqlExecutor = new Agent({
  name: "SQL_Executor",
  instructions: sqlExecutorInstructions,
  model: "gpt-4o-mini",
  tools: [mcp],
  outputType: SqlExecutorSchema,
  modelSettings: {
    temperature: 0,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

function parseRowsFromMcpToolText(text) {
  if (!text || typeof text !== "string") {
    return [];
  }

  const maybeWrapped = parseMaybeJson(text, null);
  const normalizedText =
    maybeWrapped && typeof maybeWrapped === "object" && typeof maybeWrapped.result === "string"
      ? maybeWrapped.result
      : text;

  const taggedMatch = normalizedText.match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-[^>]+>/);
  const payload = taggedMatch?.[1]?.trim() || normalizedText;

  const firstBracket = payload.indexOf("[");
  const lastBracket = payload.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1 || lastBracket < firstBracket) {
    return [];
  }

  const jsonArray = payload.slice(firstBracket, lastBracket + 1);
  return toArray(parseMaybeJson(jsonArray, []));
}

function parseMcpToolError(text) {
  const wrapped = parseMaybeJson(text, null);
  if (!wrapped || typeof wrapped !== "object") {
    return null;
  }

  const err = wrapped.error;
  if (!err || typeof err !== "object") {
    return null;
  }

  return err.message || JSON.stringify(err);
}

async function runSqlViaMcp(sqlQuery) {
  if (!SUPABASE_MCP_URL || !SUPABASE_MCP_AUTH) {
    throw new Error("SUPABASE_MCP_URL or SUPABASE_MCP_AUTH missing");
  }

  const initResponse = await fetch(SUPABASE_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_MCP_AUTH}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "simventes-workflow",
          version: "1.0.0"
        }
      }
    })
  });

  const sessionId = initResponse.headers.get("mcp-session-id");
  const initPayload = parseMaybeJson(await initResponse.text(), {});
  if (!initResponse.ok) {
    throw new Error(`MCP initialize failed: ${JSON.stringify(initPayload)}`);
  }

  if (!sessionId) {
    throw new Error("MCP session id missing after initialize");
  }

  const sqlResponse = await fetch(SUPABASE_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_MCP_AUTH}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "sql-1",
      method: "tools/call",
      params: {
        name: "execute_sql",
        arguments: {
          query: sqlQuery
        }
      }
    })
  });

  const rawSqlText = await sqlResponse.text();
  const sqlPayload = parseMaybeJson(rawSqlText, {});
  if (!sqlResponse.ok || sqlPayload?.error) {
    const err = sqlPayload?.error?.message || JSON.stringify(sqlPayload);
    throw new Error(`Failed to run sql query: ${err}`);
  }

  const content = toArray(sqlPayload?.result?.content);
  const textItem = content.find((item) => typeof item?.text === "string");
  const toolError = parseMcpToolError(textItem?.text || "");
  if (toolError) {
    throw new Error(`Failed to run sql query: ${toolError}`);
  }

  let rows = parseRowsFromMcpToolText(textItem?.text || "");

  if (!rows.length) {
    rows = parseRowsFromMcpToolText(rawSqlText);
  }

  if (
    rows.length === 1 &&
    rows[0] &&
    typeof rows[0] === "object" &&
    typeof rows[0].text === "string"
  ) {
    rows = parseRowsFromMcpToolText(rows[0].text);
  }

  return toArray(rows).map((row) => {
    if (typeof row === "string") {
      return parseMaybeJson(row, { value: row });
    }
    return row;
  });
}

async function runSql(runner, conversationHistory, sqlQuery) {
  void runner;
  void conversationHistory;
  return runSqlViaMcp(sqlQuery);
}

function normalizePromptConfig(promptRow) {
  const row = promptRow || {};
  const variables = parseMaybeJson(row.variables, {});

  const stages = toArray(parseMaybeJson(row.stages, null) ?? parseMaybeJson(variables.stages, []));
  const criteria = toArray(parseMaybeJson(row.criteria, null) ?? parseMaybeJson(variables.criteria, []));
  const promptEvaluateur =
    row.prompt_evaluateur ||
    row.Promptevaluateur ||
    row.promptevaluateur ||
    variables.prompt_evaluateur ||
    "";

  return {
    id: row.id || null,
    prompt_id: row.prompt_id || row.id || null,
    titre: row.titre || "Prompt",
    systemprompt: row.systemprompt || "",
    promptmessages: row.promptmessages || "",
    prompt_evaluateur: promptEvaluateur,
    stages,
    criteria
  };
}

export async function listAdminPrompts() {
  return withTrace("Admin prompt list", async () => {
    const runner = new Runner();
    const conversationHistory = [
      { role: "user", content: [{ type: "input_text", text: "Liste complete des prompts pour administration." }] }
    ];

    const rows = await runSql(
      runner,
      conversationHistory,
      `SELECT id, prompt_id, titre, description, actif, categorie, version, created_at
       FROM public.promptid
       ORDER BY created_at DESC NULLS LAST;`
    );

    return rows.map((row) => ({
      id: row.id || null,
      prompt_id: row.prompt_id || null,
      titre: row.titre || "",
      description: row.description || "",
      actif: String(row.actif || "").toLowerCase(),
      categorie: row.categorie || "",
      version: row.version || "",
      created_at: row.created_at || null
    }));
  });
}

export async function getAdminPrompt(promptKey) {
  return withTrace("Admin prompt detail", async () => {
    const runner = new Runner();
    const conversationHistory = [
      { role: "user", content: [{ type: "input_text", text: "Charge un prompt pour edition." }] }
    ];

    const rows = await runSql(
      runner,
      conversationHistory,
      `SELECT to_jsonb(p) AS prompt_row
       FROM public.promptid p
       WHERE p.id::text = '${sqlEscape(promptKey)}' OR p.prompt_id = '${sqlEscape(promptKey)}'
       LIMIT 1;`
    );

    if (!rows.length) {
      throw new Error("Prompt introuvable");
    }

    const row = parseMaybeJson(rows[0].prompt_row, rows[0]);
    const normalized = normalizePromptConfig(row);
    const variables = parseMaybeJson(row.variables, {});
    const testeurRaw = parseMaybeJson(row.testeur, {});
    const fallbackTesteur = {
      actif: String(variables.testeur_actif ?? 'false'),
      prompt: String(variables.testeur_prompt || '')
    };

    return {
      id: row.id || normalized.id,
      prompt_id: row.prompt_id || normalized.prompt_id,
      titre: row.titre || "",
      description: row.description || "",
      actif: row.actif ?? "true",
      categorie: row.categorie || "",
      version: row.version || "",
      systemprompt: normalized.systemprompt,
      promptmessages: normalized.promptmessages,
      prompt_evaluateur: normalized.prompt_evaluateur,
      stages: normalized.stages,
      criteria: normalized.criteria,
      variables,
      testeur: {
        actif: String(testeurRaw.actif ?? fallbackTesteur.actif ?? 'false'),
        prompt: String(testeurRaw.prompt ?? fallbackTesteur.prompt ?? '')
      }
    };
  });
}

export async function updateAdminPrompt(promptKey, payload) {
  return withTrace("Admin prompt update", async () => {
    const runner = new Runner();
    const conversationHistory = [
      { role: "user", content: [{ type: "input_text", text: "Met a jour un prompt." }] }
    ];

    await ensureTesteurColumn(runner, conversationHistory);

    const existing = await getAdminPrompt(promptKey);
    const nextVariables = {
      ...parseMaybeJson(existing.variables, {}),
      ...parseMaybeJson(payload.variables, {}),
      prompt_evaluateur: payload.prompt_evaluateur ?? existing.prompt_evaluateur ?? ""
    };

    const payloadTesteur = payload.testeur && typeof payload.testeur === 'object' ? payload.testeur : {};
    const payloadVariables = parseMaybeJson(payload.variables, {});
    const nextTesteur = {
      actif: String(
        payloadTesteur.actif ??
        payloadVariables.testeur_actif ??
        existing.testeur?.actif ??
        'false'
      ),
      prompt: String(
        payloadTesteur.prompt ??
        payloadVariables.testeur_prompt ??
        existing.testeur?.prompt ??
        ''
      )
    };

    const titre = payload.titre ?? existing.titre;
    const description = payload.description ?? existing.description;
    const actif = payload.actif ?? existing.actif;
    const categorie = payload.categorie ?? existing.categorie;
    const version = payload.version ?? existing.version;
    const systemprompt = payload.systemprompt ?? existing.systemprompt;
    const promptmessages = payload.promptmessages ?? existing.promptmessages;
    const stages = Array.isArray(payload.stages) ? payload.stages : existing.stages;
    const criteria = Array.isArray(payload.criteria) ? payload.criteria : existing.criteria;
    const promptEvaluateur = payload.prompt_evaluateur ?? existing.prompt_evaluateur;

    await runSql(
      runner,
      conversationHistory,
      `UPDATE public.promptid
       SET titre = ${sqlNullableString(titre)},
           description = ${sqlNullableString(description)},
           actif = ${sqlNullableString(String(actif))},
           categorie = ${sqlNullableString(categorie)},
           version = ${sqlNullableString(version)},
           systemprompt = ${sqlNullableString(systemprompt)},
           promptmessages = ${sqlNullableString(promptmessages)},
           stages = ${sqlJson(stages)},
           criteria = ${sqlJson(criteria)},
           variables = ${sqlJson(nextVariables)},
           testeur = ${sqlJson(nextTesteur)},
           "Promptevaluateur" = ${sqlNullableString(promptEvaluateur)}
       WHERE id::text = '${sqlEscape(promptKey)}' OR prompt_id = '${sqlEscape(promptKey)}';`
    );

    return getAdminPrompt(promptKey);
  });
}

export async function createAdminPrompt(payload) {
  return withTrace("Admin prompt create", async () => {
    const runner = new Runner();
    const conversationHistory = [
      { role: "user", content: [{ type: "input_text", text: "Cree un nouveau prompt." }] }
    ];

    const promptId = (payload.prompt_id || `pmpt_admin_${Date.now()}`).trim();
    if (!promptId) {
      throw new Error("prompt_id is required");
    }

    const existingRows = await runSql(
      runner,
      conversationHistory,
      `SELECT id FROM public.promptid WHERE prompt_id = '${sqlEscape(promptId)}' LIMIT 1;`
    );

    if (existingRows.length) {
      throw new Error("Un prompt avec ce prompt_id existe deja");
    }

    await ensureTesteurColumn(runner, conversationHistory);

    const stages = Array.isArray(payload.stages) ? payload.stages : [];
    const criteria = Array.isArray(payload.criteria) ? payload.criteria : [];
    const variables = parseMaybeJson(payload.variables, {});
    const promptEvaluateur = payload.prompt_evaluateur || "";
    const payloadTesteur = payload.testeur && typeof payload.testeur === 'object' ? payload.testeur : {};
    const newTesteur = {
      actif: String(payloadTesteur.actif ?? variables.testeur_actif ?? 'false'),
      prompt: String(payloadTesteur.prompt ?? variables.testeur_prompt ?? '')
    };

    const mergedVariables = {
      ...variables,
      prompt_evaluateur: promptEvaluateur,
      stages,
      criteria
    };

    await runSql(
      runner,
      conversationHistory,
      `INSERT INTO public.promptid (
        prompt_id,
        titre,
        description,
        actif,
        categorie,
        created_at,
        version,
        stages,
        criteria,
        systemprompt,
        promptmessages,
        variables,
        testeur,
        "Promptevaluateur"
      ) VALUES (
        ${sqlNullableString(promptId)},
        ${sqlNullableString(payload.titre || "Nouveau prompt")},
        ${sqlNullableString(payload.description || "")},
        ${sqlNullableString(String(payload.actif ?? "true"))},
        ${sqlNullableString(payload.categorie || "")},
        to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        ${sqlNullableString(payload.version || "v1")},
        ${sqlJson(stages)},
        ${sqlJson(criteria)},
        ${sqlNullableString(payload.systemprompt || "")},
        ${sqlNullableString(payload.promptmessages || "")},
        ${sqlJson(mergedVariables)},
        ${sqlJson(newTesteur)},
        ${sqlNullableString(promptEvaluateur)}
      );`
    );

    return getAdminPrompt(promptId);
  });
}

export async function deleteAdminPrompt(promptKey) {
  return withTrace("Admin prompt delete", async () => {
    const runner = new Runner();
    const conversationHistory = [
      { role: "user", content: [{ type: "input_text", text: "Supprime un prompt." }] }
    ];

    const rows = await runSql(
      runner,
      conversationHistory,
      `DELETE FROM public.promptid
       WHERE id::text = '${sqlEscape(promptKey)}' OR prompt_id = '${sqlEscape(promptKey)}'
       RETURNING id, prompt_id, titre;`
    );

    if (!rows.length) {
      throw new Error("Prompt introuvable pour suppression");
    }

    return {
      id: rows[0].id || null,
      prompt_id: rows[0].prompt_id || null,
      titre: rows[0].titre || null,
      deleted: true
    };
  });
}

async function fetchPromptConfig(runner, conversationHistory, selectedPromptId) {
  const whereClause = selectedPromptId
    ? `WHERE p.id::text = '${sqlEscape(selectedPromptId)}' OR p.prompt_id = '${sqlEscape(selectedPromptId)}'`
    : "WHERE LOWER(COALESCE(p.actif::text, 'true')) IN ('true', 't', '1', 'yes', 'y', 'on')";

  const rows = await runSql(
    runner,
    conversationHistory,
    `SELECT to_jsonb(p) AS prompt_row
     FROM public.promptid p
     ${whereClause}
     ORDER BY p.created_at DESC NULLS LAST
     LIMIT 1;`
  );

  if (!rows.length) {
    throw new Error("No active prompt found in promptid");
  }

  const promptRow = parseMaybeJson(rows[0].prompt_row, rows[0]);
  return normalizePromptConfig(promptRow);
}

async function fetchConversationLog(runner, conversationHistory, conversationId) {
  if (!conversationId) {
    return null;
  }

  const rows = await runSql(
    runner,
    conversationHistory,
    `SELECT conversation_id, user_id, promptid, prompt_evaluateur, etapes, criterea_with_coefficient, stage_evaluations, full_conversation_transcript, conversation_status
     FROM public.conversation_chat_logs
     WHERE conversation_id = '${sqlEscape(conversationId)}'
     LIMIT 1;`
  );

  if (!rows.length) {
    return null;
  }

  return rows[0];
}

let testeurColumnEnsured = false;
async function ensureTesteurColumn(runner, conversationHistory) {
  if (testeurColumnEnsured) return;
  await runSql(
    runner,
    conversationHistory,
    `ALTER TABLE public.promptid ADD COLUMN IF NOT EXISTS testeur jsonb DEFAULT '{}'::jsonb;`
  );
  testeurColumnEnsured = true;
}

async function ensureConversationLogsTable(runner, conversationHistory) {
  await runSql(
    runner,
    conversationHistory,
    `CREATE TABLE IF NOT EXISTS public.conversation_chat_logs (
      conversation_id text PRIMARY KEY DEFAULT (
        'conv_' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 8)
      ),
      conversation_status text DEFAULT 'in_progress',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      user_id text,
      promptid text,
      prompt_evaluateur text,
      etapes jsonb,
      criterea_with_coefficient jsonb,
      stage_evaluations jsonb DEFAULT '[]'::jsonb,
      full_conversation_transcript text
    );`
  );
}

async function createConversationLog(runner, conversationHistory, config) {
  const rows = await runSql(
    runner,
    conversationHistory,
    `INSERT INTO public.conversation_chat_logs (
      conversation_status,
      created_at,
      updated_at,
      user_id,
      promptid,
      prompt_evaluateur,
      etapes,
      criterea_with_coefficient,
      stage_evaluations
    ) VALUES (
      'in_progress',
      now(),
      now(),
      ${sqlNullableString(config.user_id)},
      ${sqlNullableString(config.prompt_id)},
      ${sqlNullableString(config.prompt_evaluateur)},
      ${sqlJson(config.stages)},
      ${sqlJson(config.criteria)},
      '[]'::jsonb
    )
    RETURNING conversation_id;`
  );

  if (!rows.length || !rows[0].conversation_id) {
    throw new Error("Unable to create conversation in conversation_chat_logs");
  }

  return String(rows[0].conversation_id);
}

async function appendStageEvaluation(runner, conversationHistory, conversationId, evaluation) {
  const payload = [evaluation];
  await runSql(
    runner,
    conversationHistory,
    `UPDATE public.conversation_chat_logs
     SET stage_evaluations = COALESCE(stage_evaluations, '[]'::jsonb) || ${sqlJson(payload)},
         updated_at = now()
     WHERE conversation_id = '${sqlEscape(conversationId)}';`
  );
}

async function updateConversationTranscript(runner, conversationHistory, conversationId, transcript) {
  await runSql(
    runner,
    conversationHistory,
    `UPDATE public.conversation_chat_logs
     SET full_conversation_transcript = ${sqlNullableString(transcript)},
         updated_at = now()
     WHERE conversation_id = '${sqlEscape(conversationId)}';`
  );
}

async function finalizeConversation(runner, conversationHistory, conversationId, transcript) {
  await runSql(
    runner,
    conversationHistory,
    `UPDATE public.conversation_chat_logs
     SET full_conversation_transcript = ${sqlNullableString(transcript)},
         conversation_status = 'completed',
         updated_at = now()
     WHERE conversation_id = '${sqlEscape(conversationId)}';`
  );
}

function toWorkflowResult(agentResult, meta) {
  const parsed = {
    ...(agentResult.output_parsed || {}),
    conversation_id: meta.conversation_id,
    prompt_id: meta.prompt_id,
    stage_index: meta.stage_index,
    stage_name: meta.stage_name,
    simulation_complete: meta.simulation_complete,
    stages: toArray(meta.stages),
    criteria: toArray(meta.criteria),
    stage_evaluations: toArray(meta.stage_evaluations)
  };

  return {
    output_text: JSON.stringify(parsed),
    output_parsed: parsed
  };
}

export async function listPromptOptions() {
  return withTrace("Prompt options", async () => {
    const runner = new Runner();
    const conversationHistory = [
      { role: "user", content: [{ type: "input_text", text: "Liste les prompts actifs." }] }
    ];

    const rows = await runSql(
      runner,
      conversationHistory,
      `SELECT to_jsonb(p) AS prompt_row
       FROM public.promptid p
       WHERE LOWER(COALESCE(actif::text, 'true')) IN ('true', 't', '1', 'yes', 'y', 'on')
       ORDER BY created_at DESC NULLS LAST;`
    );

    return rows.map((row) => {
      const raw = parseMaybeJson(row.prompt_row, row);
      const normalized = normalizePromptConfig(raw);
      const testeurRaw = parseMaybeJson(raw.testeur, {});
      const variables = parseMaybeJson(raw.variables, {});
      return {
        id: normalized.id,
        prompt_id: normalized.prompt_id,
        titre: normalized.titre,
        stages: normalized.stages,
        criteria: normalized.criteria,
        testeur_actif: String(testeurRaw.actif ?? variables.testeur_actif ?? 'false').toLowerCase(),
        testeur_prompt: String(testeurRaw.prompt ?? variables.testeur_prompt ?? '')
      };
    });
  });
}

export async function runWorkflow(workflow) {
  return withTrace("First Sales", async () => {
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: process.env.WORKFLOW_ID || ""
      }
    });

    const conversationHistory = [
      { role: "user", content: [{ type: "input_text", text: workflow.input_as_text }] }
    ];

    const selectedPromptId = workflow.prompt_id || null;
    const requestedConversationId = workflow.conversation_id || null;

    await ensureConversationLogsTable(runner, conversationHistory);

    const promptConfig = await fetchPromptConfig(runner, conversationHistory, selectedPromptId);

    let conversationLog = await fetchConversationLog(runner, conversationHistory, requestedConversationId);
    let conversationId = requestedConversationId;

    if (!conversationLog) {
      conversationId = await createConversationLog(runner, conversationHistory, {
        user_id: workflow.user_id || null,
        prompt_id: promptConfig.id || promptConfig.prompt_id,
        prompt_evaluateur: promptConfig.prompt_evaluateur,
        stages: promptConfig.stages,
        criteria: promptConfig.criteria
      });

      conversationLog = {
        conversation_id: conversationId,
        stage_evaluations: [],
        full_conversation_transcript: "",
        etapes: promptConfig.stages,
        criterea_with_coefficient: promptConfig.criteria,
        prompt_evaluateur: promptConfig.prompt_evaluateur
      };
    } else {
      conversationId = String(conversationLog.conversation_id);
    }

    const existingStageEvaluations = toArray(parseMaybeJson(conversationLog.stage_evaluations, []));
    const stagesFromLog = toArray(parseMaybeJson(conversationLog.etapes, promptConfig.stages));
    const criteriaFromLog = toArray(parseMaybeJson(conversationLog.criterea_with_coefficient, promptConfig.criteria));
    let stageEvaluationsForResponse = [...existingStageEvaluations];

    const currentStageIndex = existingStageEvaluations.length;
    const currentStageName = stagesFromLog[currentStageIndex] || "Fin";
    const simulationAlreadyComplete = currentStageIndex >= stagesFromLog.length;

    if (simulationAlreadyComplete) {
      return {
        output_text: JSON.stringify({
          client_reply: "La simulation est deja terminee.",
          conversation_id: conversationId,
          prompt_id: promptConfig.prompt_id,
          stage_index: currentStageIndex,
          stage_name: "Fin",
          simulation_complete: true,
          stages: stagesFromLog,
          criteria: criteriaFromLog,
          stage_evaluations: stageEvaluationsForResponse
        }),
        output_parsed: {
          client_reply: "La simulation est deja terminee.",
          conversation_id: conversationId,
          prompt_id: promptConfig.prompt_id,
          stage_index: currentStageIndex,
          stage_name: "Fin",
          simulation_complete: true,
          stages: stagesFromLog,
          criteria: criteriaFromLog,
          stage_evaluations: stageEvaluationsForResponse
        }
      };
    }

    const stageTranscript = `User: ${workflow.input_as_text}`;

    const agent1ResultTemp = await runner.run(agent1, [...conversationHistory], {
      context: {
        stateCurrentStageName: currentStageName,
        stateCurrentStageIndex: currentStageIndex,
        stateCurrentDifficultyLevel: 2,
        stateStageTranscript: stageTranscript,
        workflowInputAsText: workflow.input_as_text,
        stateConversationId: conversationId,
        statePromptSystem: promptConfig.systemprompt,
        statePromptMessages: promptConfig.promptmessages,
        stateStages: stagesFromLog,
        stateCriteria: criteriaFromLog
      }
    });

    conversationHistory.push(...agent1ResultTemp.newItems.map((item) => item.rawItem));
    const agent1Result = requireFinalOutput(agent1ResultTemp);

    const updatedTranscript = `${conversationLog.full_conversation_transcript || ""}\nUser: ${workflow.input_as_text}\nClient: ${agent1Result.output_parsed.client_reply}`.trim();

    await updateConversationTranscript(runner, conversationHistory, conversationId, updatedTranscript);

    let simulationComplete = false;
    let resultingStageIndex = currentStageIndex;
    let resultingStageName = currentStageName;

    const turnsInConversation = countUserTurns(updatedTranscript);
    const minTurnsPerStage = Number(process.env.MIN_TURNS_PER_STAGE || 3);
    const autoCompleteByTurns = turnsInConversation >= (currentStageIndex + 1) * minTurnsPerStage;
    const shouldCompleteStage = agent1Result.output_parsed.stage_complete === true || autoCompleteByTurns;

    if (shouldCompleteStage) {
      const evaluateurResultTemp = await runner.run(evaluateur, [...conversationHistory], {
        context: {
          stateCurrentStageName: currentStageName,
          stateCurrentStageIndex: currentStageIndex,
          stateCurrentDifficultyLevel: 2,
          stateStageTranscript: `${stageTranscript}\nClient: ${agent1Result.output_parsed.client_reply}`,
          stateCriteria: criteriaFromLog,
          statePromptEvaluateur: promptConfig.prompt_evaluateur
        }
      });

      conversationHistory.push(...evaluateurResultTemp.newItems.map((item) => item.rawItem));
      const evaluateurResult = requireFinalOutput(evaluateurResultTemp);

      const stageEvaluation = {
        ...(evaluateurResult.output_parsed.evaluation || {}),
        stage_index: currentStageIndex,
        stage_name: currentStageName,
        completed_at: new Date().toISOString()
      };

      await appendStageEvaluation(runner, conversationHistory, conversationId, stageEvaluation);
      stageEvaluationsForResponse = [...stageEvaluationsForResponse, stageEvaluation];

      resultingStageIndex = currentStageIndex + 1;
      resultingStageName = stagesFromLog[resultingStageIndex] || "Fin";
      simulationComplete = resultingStageIndex >= stagesFromLog.length;

      if (simulationComplete) {
        await finalizeConversation(runner, conversationHistory, conversationId, updatedTranscript);
      }
    }

    return toWorkflowResult(agent1Result, {
      conversation_id: conversationId,
      prompt_id: promptConfig.prompt_id,
      stage_index: resultingStageIndex,
      stage_name: resultingStageName,
      simulation_complete: simulationComplete,
      stages: stagesFromLog,
      criteria: criteriaFromLog,
      stage_evaluations: stageEvaluationsForResponse
    });
  });
}
