import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';

function App() {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [migratedLinks, setMigratedLinks] = useState([]);
  const [copiedIndex, setCopiedIndex] = useState(-1);

  // Fetch available ServiceNow tables on load
  useEffect(() => {
    invoke('listServiceNowTables').then(setTables);
  }, []);

  // Fetch table records
  const handleFetch = async () => {
    if (!selectedTable) return;
    setLoading(true);
    setRecords([]);
    setMessage('');
    setMigratedLinks([]);
    try {
      const result = await invoke('fetchRecordsByTable', { table: selectedTable });
      setRecords(result);
      setMessage(`✅ Loaded ${result.length} records`);
    } catch (err) {
      setMessage(`❌ Error fetching records: ${err.message}`);
    }
    setLoading(false);
  };

  // Migrate records to Jira
  const handleMigrate = async () => {
    if (!records.length) return;
    setMigrating(true);
    setProgress(0);
    setMessage('');
    const links = [];
    const alreadyMigrated = [];

    for (let i = 0; i < records.length; i++) {
      try {
        const migrated = await invoke('migrateToJira', { projects: [records[i]] });
        const jiraUrl = migrated[0].jiraUrl;

        if (jiraUrl.startsWith('ALREADY MIGRATED')) {
          alreadyMigrated.push({
            name: records[i].name,
            url: jiraUrl.split('ALREADY MIGRATED: ')[1] || jiraUrl
          });
        }
        links.push(jiraUrl);
      } catch (err) {
        links.push(`ERROR: ${err.message}`);
      }
      setProgress(Math.round(((i + 1) / records.length) * 100));
    }

    setMigratedLinks(links);
    setMigrating(false);
    setMessage('✅ Migration complete!');

    // Show one alert for all already migrated tickets
    if (alreadyMigrated.length > 0) {
      const msg =
        'Already migrated ticket(s):\n\n' +
        alreadyMigrated.map(item => `${item.name}: ${item.url}`).join('\n');
      alert(msg);
    }
  };

  // Copy link helper
  const handleCopyLink = async (url, idx) => {
    await navigator.clipboard.writeText(url);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(-1), 1500);
  };

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: 'auto', fontFamily: 'Segoe UI, Arial' }}>
      <h2 style={{ color: '#0747A6', marginBottom: 20 }}>ServiceNow to JSM Migration</h2>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '20px'
      }}>
        <select
          value={selectedTable}
          onChange={e => setSelectedTable(e.target.value)}
          style={{
            padding: '10px',
            fontSize: '14px',
            borderRadius: '6px',
            border: '1px solid #ccc',
            flex: 1
          }}>
          <option value="">-- Select ServiceNow Table --</option>
          {tables.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          onClick={handleFetch}
          style={{
            padding: '10px 16px',
            backgroundColor: '#0052cc',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            cursor: 'pointer'
          }}>
          Load Tickets
        </button>
      </div>

      {loading && <div>🔄 Loading records from <strong>{selectedTable}</strong>...</div>}
      {!loading && message && (
        <div style={{ margin: '8px 0', color: message.startsWith('✅') ? 'green' : 'red' }}>
          {message}
        </div>
      )}

      <ul>
        {records.map(record => (
          <li key={record.id} style={{ marginBottom: 6 }}>
            <strong>{record.name}</strong>{" - "}{record.summary}
          </li>
        ))}
      </ul>

      {records.length > 0 && (
        <button
          onClick={handleMigrate}
          disabled={migrating}
          style={{
            padding: '12px 24px',
            backgroundColor: '#36B37E',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontWeight: 'bold',
            fontSize: 14,
            cursor: migrating ? 'not-allowed' : 'pointer',
            marginTop: 20,
          }}
        >
          {migrating ? `Migrating... ${progress}%` : '🚀 Migrate to JSM'}
        </button>
      )}

      {migrating && (
        <div style={{ marginTop: 10, height: 12, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{
            width: `${progress}%`,
            background: '#36b37e',
            height: '100%',
            transition: 'width 0.3s ease'
          }} />
        </div>
      )}

      {migratedLinks.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4>🔗 Migrated Jira Tickets:</h4>
          <ul>
            {migratedLinks.map((url, idx) => {
              let displayUrl = url;
              let realLink = url;

              if (url.startsWith('ALREADY MIGRATED:')) {
                realLink = url.replace('ALREADY MIGRATED: ', '').trim();
                displayUrl = realLink;
              }

              return (
                <li key={idx} style={{ marginBottom: 6 }}>
                  {url.startsWith('ERROR') ? (
                    <pre style={{
                      color: 'red',
                      background: '#f7dddd',
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      display: 'inline-block'
                    }}>
                      {url}
                    </pre>
                  ) : (
                    <>
                      <a href={realLink} target="_self" rel="noopener noreferrer">{displayUrl}</a>
                      <button
                        style={{
                          marginLeft: 8,
                          padding: "2px 10px",
                          fontSize: 12,
                          borderRadius: 4,
                          border: "1px solid #36b37e",
                          color: "#036",
                          cursor: "pointer",
                          background: copiedIndex === idx ? "#d2f3e3" : "#fff"
                        }}
                        onClick={() => handleCopyLink(realLink, idx)}
                      >
                        {copiedIndex === idx ? "Copied!" : "Copy Link"}
                      </button>
                      <span style={{ fontSize: 11, color: "#555", marginLeft: 6 }}>
                        (right-click to open or paste in new tab)
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;
