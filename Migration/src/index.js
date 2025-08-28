import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

// ---- CONFIGURATION ----
const SERVICENOW_BASE = 'https://dev331433.service-now.com';
const username = process.env.SERVICENOW_USER;
const password = process.env.SERVICENOW_PASS;

const JIRA_PROJECT_KEY = 'SER';
const JIRA_ISSUE_TYPE = 'Task';

const TABLES = ['incident', 'problem', 'change_request', 'sc_task']; // Add more as needed

// ---- ADF Helper ----
function toADF(text) {
  return {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: text || '' }] }
    ]
  };
}

// ---- ServiceNow Record Fetcher ----
async function fetchRecordsByTable(tableName) {
  const response = await api.fetch(`${SERVICENOW_BASE}/api/now/table/${tableName}?sysparm_limit=5`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    }
  });
  const data = await response.json();
  return data.result.map(p => ({
    id: p.sys_id,
    name: p.number || p.name || '',
    summary: p.short_description || p.name || p.number || 'No summary',
    description: p.description || '',
    status: p.state || '',
    priority: p.priority || '',   // number like 1,2,3...
  }));
}

// ---- Deduplication Storage (by ServiceNow "number") ----
async function getMappedJiraIssueKey(snowNumber) {
  if (!snowNumber) return null;
  const mapping = await storage.get('number-mapping') || {};
  return mapping[snowNumber];
}

async function saveMapping(snowNumber, jiraKey) {
  if (!snowNumber) return;
  const mapping = await storage.get('number-mapping') || {};
  mapping[snowNumber] = jiraKey;
  await storage.set('number-mapping', mapping);
}

// ---- Priority Mapper ----
function mapPriority(snowPriority) {
  // ServiceNow priority comes as number or string ("1", "2", "3", etc.)
  const val = String(snowPriority).trim();

  switch (val) {
    case '1':
    case 'Critical': return 'Critical';   // Jira "Critical"

    case '2':
    case 'High': return 'High';

    case '3':
    case 'Moderate': return 'Medium';     // SN "Moderate" → Jira "Medium"

    case '4':
    case 'Low': return 'Low';

    case '5':
    case 'Planning': return 'Lowest';     // SN "Planning" → Jira "Lowest"

    default: return 'Medium';
  }
}

// ---- Status Mapper ----
// ---- Status Mapper ----
function mapStatus(snowStatus) {
  switch ((snowStatus || '').toLowerCase()) {
    case 'new': 
      return 'Open';
    case 'assess': 
      return 'Pending';
    case 'root cause analysis': 
      return 'Pending';
    case 'fix in progress': 
      return 'Work in progress';
    case 'resolved': 
      return 'Done';
    case 'closed': 
      return 'Done';
    default: 
      return 'Open';   // fallback
  }
}

// ---- Create Jira Issue ----
async function createJiraIssue(record) {
  const uniqueNumber = record.name;

  if (uniqueNumber) {
    const existingKey = await getMappedJiraIssueKey(uniqueNumber);
    if (existingKey) {
      const checkResponse = await api.asApp().requestJira(route`/rest/api/3/issue/${existingKey}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (checkResponse.ok) {
        return `ALREADY MIGRATED: https://forgeappdevdemo.atlassian.net/browse/${existingKey}`;
      } else {
        const mapping = await storage.get('number-mapping') || {};
        delete mapping[uniqueNumber];
        await storage.set('number-mapping', mapping);
      }
    }
  }

  const payload = {
    fields: {
      project: { key: JIRA_PROJECT_KEY },
      summary: record.summary,
      description: toADF(record.description),
      issuetype: { name: JIRA_ISSUE_TYPE },
      priority: { name: mapPriority(record.priority) },   // <--- Mapping applied
    }
  };

  const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const res = await response.json();

  if (!response.ok) {
    return `ERROR: ${res.errorMessages ? res.errorMessages.join('; ') : 'Unknown error'} | ${JSON.stringify(res.errors)}`;
  }

  if (uniqueNumber) {
    await saveMapping(uniqueNumber, res.key);
  }

  // --- Auto status transition ---
  const targetStatus = mapStatus(record.status);
  let finalUrl = `https://forgeappdevdemo.atlassian.net/browse/${res.key}`;
  try {
    const transitionsResp = await api.asApp().requestJira(route`/rest/api/3/issue/${res.key}/transitions`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    const transitionsData = await transitionsResp.json();
    if (transitionsResp.ok && transitionsData.transitions) {
      const transition = transitionsData.transitions.find(t => t.to && t.to.name.toLowerCase() === targetStatus.toLowerCase());
      if (transition) {
        const doTransitionResp = await api.asApp().requestJira(route`/rest/api/3/issue/${res.key}/transitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transition: { id: transition.id } })
        });
        if (doTransitionResp.ok) {
          finalUrl += ` (Status set to ${targetStatus})`;
        }
      }
    }
  } catch (err) {}

  return finalUrl;
}

// ---- Resolver ----
const resolver = new Resolver();

resolver.define('listServiceNowTables', async () => TABLES);

resolver.define('fetchRecordsByTable', async ({ payload }) => {
  return await fetchRecordsByTable(payload.table);
});

resolver.define('migrateToJira', async ({ payload }) => {
  const results = [];
  for (const record of payload.projects) {
    const jiraUrlOrError = await createJiraIssue(record);
    results.push({ ...record, jiraUrl: jiraUrlOrError });
  }
  return results;
});

export const handler = resolver.getDefinitions();
