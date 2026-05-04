import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} from '@aws-sdk/client-athena';

const RESULTS_BUCKET = 's3://aws-athena-query-results-226370841285-us-east-1/';
const POLL_INTERVAL_MS = 800;
const MAX_POLLS = 50;

function getClient() {
  return new AthenaClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export async function runAthenaQuery(
  sql: string,
  database: string
): Promise<Record<string, string>[]> {
  const client = getClient();

  const { QueryExecutionId } = await client.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: database },
      ResultConfiguration: { OutputLocation: RESULTS_BUCKET },
    })
  );

  if (!QueryExecutionId) throw new Error('No QueryExecutionId returned');

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const { QueryExecution } = await client.send(
      new GetQueryExecutionCommand({ QueryExecutionId })
    );
    const state = QueryExecution?.Status?.State;
    if (state === 'SUCCEEDED') break;
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(`Athena query ${state}: ${QueryExecution?.Status?.StateChangeReason}`);
    }
    if (i === MAX_POLLS - 1) throw new Error('Athena query timed out after 40s');
  }

  const rows: Record<string, string>[] = [];
  let nextToken: string | undefined;
  let headers: string[] = [];

  do {
    const page = await client.send(
      new GetQueryResultsCommand({ QueryExecutionId, NextToken: nextToken })
    );
    const pageRows = page.ResultSet?.Rows ?? [];

    if (headers.length === 0) {
      headers = pageRows[0]?.Data?.map(d => d.VarCharValue ?? '') ?? [];
      pageRows.slice(1).forEach(row => {
        const obj: Record<string, string> = {};
        row.Data?.forEach((cell, i) => { obj[headers[i]] = cell.VarCharValue ?? ''; });
        rows.push(obj);
      });
    } else {
      pageRows.forEach(row => {
        const obj: Record<string, string> = {};
        row.Data?.forEach((cell, i) => { obj[headers[i]] = cell.VarCharValue ?? ''; });
        rows.push(obj);
      });
    }

    nextToken = page.NextToken;
  } while (nextToken);

  return rows;
}
