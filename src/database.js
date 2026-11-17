import pg from 'pg';

let pool=null,initialWrite=false;
const MAX_BATCH=500;
let status={configured:false,connected:false,lastWriteAt:null,lastError:null};
export function databaseStatus(){return {...status};}
export async function initialiseDatabase(){
  if(!process.env.DATABASE_URL){status={...status,configured:false,connected:false,lastError:'DATABASE_URL is not configured'};return null;}
  if(pool)await pool.end().catch(()=>{});
  pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false},max:4,idleTimeoutMillis:30000,connectionTimeoutMillis:10000,statement_timeout:15000,application_name:'pumpwatch'});
  pool.on('error',error=>{status={...status,connected:false,lastError:error.message};console.error('PostgreSQL pool error:',error.message)});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state(id SMALLINT PRIMARY KEY CHECK(id=1),payload JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS tokens(address TEXT PRIMARY KEY,symbol TEXT,name TEXT,first_discovered_at TIMESTAMPTZ,last_discovered_at TIMESTAMPTZ,last_evaluated_at TIMESTAMPTZ,source TEXT,payload JSONB NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS market_snapshots(address TEXT NOT NULL,observed_at TIMESTAMPTZ NOT NULL,price_usd DOUBLE PRECISION,liquidity_usd DOUBLE PRECISION,volume_5m_usd DOUBLE PRECISION,volume_24h_usd DOUBLE PRECISION,buys_5m INTEGER,sells_5m INTEGER,payload JSONB NOT NULL,PRIMARY KEY(address,observed_at));
    CREATE INDEX IF NOT EXISTS market_snapshots_observed_idx ON market_snapshots(observed_at DESC);
    CREATE TABLE IF NOT EXISTS score_history(address TEXT NOT NULL,evaluated_at TIMESTAMPTZ NOT NULL,score DOUBLE PRECISION,model TEXT,passed BOOLEAN,payload JSONB NOT NULL,PRIMARY KEY(address,evaluated_at));
    CREATE INDEX IF NOT EXISTS score_history_score_idx ON score_history(score DESC,evaluated_at DESC);
    CREATE TABLE IF NOT EXISTS leaderboard_history(captured_at TIMESTAMPTZ NOT NULL,rank INTEGER NOT NULL,address TEXT NOT NULL,score DOUBLE PRECISION,payload JSONB NOT NULL,PRIMARY KEY(captured_at,rank));
    CREATE INDEX IF NOT EXISTS leaderboard_address_idx ON leaderboard_history(address,captured_at DESC);
    CREATE TABLE IF NOT EXISTS scan_runs(id BIGSERIAL PRIMARY KEY,started_at TIMESTAMPTZ NOT NULL,finished_at TIMESTAMPTZ,status TEXT NOT NULL,diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb);
    CREATE UNIQUE INDEX IF NOT EXISTS scan_runs_started_idx ON scan_runs(started_at);
    CREATE TABLE IF NOT EXISTS paper_trades(id TEXT PRIMARY KEY,address TEXT,symbol TEXT,type TEXT NOT NULL,occurred_at TIMESTAMPTZ NOT NULL,realised_pnl_gbp DOUBLE PRECISION,payload JSONB NOT NULL);
    CREATE INDEX IF NOT EXISTS paper_trades_occurred_idx ON paper_trades(occurred_at DESC);
    CREATE TABLE IF NOT EXISTS risk_assessments(address TEXT NOT NULL,assessed_at TIMESTAMPTZ NOT NULL,score DOUBLE PRECISION,available BOOLEAN,payload JSONB NOT NULL,PRIMARY KEY(address,assessed_at));
    CREATE INDEX IF NOT EXISTS risk_assessments_time_idx ON risk_assessments(assessed_at DESC);
  `);
  status={configured:true,connected:true,lastWriteAt:null,lastError:null};return pool;
}
export async function loadDatabaseState(){if(!pool)return null;const {rows}=await pool.query('SELECT payload FROM app_state WHERE id=1');return rows[0]?.payload||null;}
export async function saveDatabaseState(state){
  if(!pool)return false;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO app_state(id,payload,updated_at) VALUES(1,$1::jsonb,now()) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,[JSON.stringify(state)]);
    const tokens=Object.values(state.tokenUniverse||{}).filter(t=>t.address).slice(-MAX_BATCH);
    if(tokens.length)await client.query(`INSERT INTO tokens(address,symbol,name,first_discovered_at,last_discovered_at,last_evaluated_at,source,payload)
      SELECT address,symbol,name,first_discovered_at,last_discovered_at,last_evaluated_at,source,payload
      FROM jsonb_to_recordset($1::jsonb) AS x(address text,symbol text,name text,first_discovered_at timestamptz,last_discovered_at timestamptz,last_evaluated_at timestamptz,source text,payload jsonb)
      ON CONFLICT(address) DO UPDATE SET symbol=COALESCE(EXCLUDED.symbol,tokens.symbol),name=COALESCE(EXCLUDED.name,tokens.name),
      last_discovered_at=GREATEST(tokens.last_discovered_at,EXCLUDED.last_discovered_at),last_evaluated_at=GREATEST(tokens.last_evaluated_at,EXCLUDED.last_evaluated_at),
      source=COALESCE(EXCLUDED.source,tokens.source),payload=EXCLUDED.payload`,[JSON.stringify(tokens.map(t=>({address:t.address,symbol:t.symbol||null,name:t.name||null,first_discovered_at:t.firstDiscoveredAt||null,last_discovered_at:t.lastDiscoveredAt||null,last_evaluated_at:t.lastEvaluatedAt||null,source:t.source||null,payload:t})))]);
    const snapshots=[];
    for(const [address,history] of Object.entries(state.marketHistory||{})){
      const rows=initialWrite?(history||[]):(history||[]).slice(-1);
      for(const snap of rows)snapshots.push({address,observed_at:snap.at,price_usd:snap.priceUsd||null,liquidity_usd:snap.liquidityUsd||null,volume_5m_usd:snap.volume5mUsd||null,volume_24h_usd:snap.volume24hUsd||null,buys_5m:snap.buys5m??null,sells_5m:snap.sells5m??null,payload:snap});
    }
    if(snapshots.length)await client.query(`INSERT INTO market_snapshots(address,observed_at,price_usd,liquidity_usd,volume_5m_usd,volume_24h_usd,buys_5m,sells_5m,payload)
      SELECT address,observed_at,price_usd,liquidity_usd,volume_5m_usd,volume_24h_usd,buys_5m,sells_5m,payload FROM jsonb_to_recordset($1::jsonb)
      AS x(address text,observed_at timestamptz,price_usd float8,liquidity_usd float8,volume_5m_usd float8,volume_24h_usd float8,buys_5m int,sells_5m int,payload jsonb)
      ON CONFLICT(address,observed_at) DO NOTHING`,[JSON.stringify(snapshots)]);
    const scores=[];
    for(const [address,c] of Object.entries(state.candidatePool||{})){const at=c.lastSuccessfulEvaluationAt||c.scannedAt;if(at)scores.push({address,evaluated_at:at,score:Number.isFinite(Number(c.score))?Number(c.score):null,model:c.model||null,passed:!!c.passed,payload:c});}
    if(scores.length)await client.query(`INSERT INTO score_history(address,evaluated_at,score,model,passed,payload)
      SELECT address,evaluated_at,score,model,passed,payload FROM jsonb_to_recordset($1::jsonb)
      AS x(address text,evaluated_at timestamptz,score float8,model text,passed boolean,payload jsonb)
      ON CONFLICT(address,evaluated_at) DO NOTHING`,[JSON.stringify(scores)]);
    if(state.candidates?.length){const capturedAt=state.lastDiscoveryAt||new Date().toISOString();const board=state.candidates.map((c,i)=>({captured_at:capturedAt,rank:i+1,address:c.address,score:Number(c.score)||0,payload:c}));await client.query(`INSERT INTO leaderboard_history(captured_at,rank,address,score,payload)
      SELECT captured_at,rank,address,score,payload FROM jsonb_to_recordset($1::jsonb) AS x(captured_at timestamptz,rank int,address text,score float8,payload jsonb)
      ON CONFLICT(captured_at,rank) DO NOTHING`,[JSON.stringify(board)]);}
    await client.query('COMMIT');initialWrite=true;status={configured:true,connected:true,lastWriteAt:new Date().toISOString(),lastError:null};return true;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});status={...status,connected:false,lastError:error.message};throw error;}
  finally{client.release();}
}
export async function closeDatabase(){if(pool){await pool.end();pool=null;}}
