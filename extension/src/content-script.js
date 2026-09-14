const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function captureGrid() {
  const headers = [...document.querySelectorAll('.ag-header-cell')].map(cell => ({
    colId: cell.getAttribute('col-id') || cell.dataset.colId || '',
    label: [...cell.querySelectorAll('.ag-header-cell-text')].map(node => clean(node.textContent)).filter(Boolean).join(' '),
  }));
  const rows = [...document.querySelectorAll('.ag-row[row-index], .ag-row[row-id]')].map(row => ({
    rowIndex: row.getAttribute('row-index'), rowId: row.getAttribute('row-id'),
    employee_name: clean(row.querySelector('.location-schedule-employee-cell__name')?.textContent),
    primary_job: clean(row.querySelector('[col-id="primaryJob"] span')?.textContent || row.querySelector('[col-id="primaryJob"]')?.textContent),
    cells: [...row.querySelectorAll('[col-id]')].map(cell => ({
      colId: cell.getAttribute('col-id') || '',
      titles: [...cell.querySelectorAll('.location-schedule-cell__title')].map((node, occurrence) => ({
        text: clean(node.textContent),
        occurrence,
      })),
    })).filter(cell => cell.titles.length),
  }));
  const viewport = document.querySelector('.ag-body-viewport, .ag-center-cols-viewport');
  return { headers, rows, scrollTop: viewport?.scrollTop || 0, scrollHeight: viewport?.scrollHeight || 0, clientHeight: viewport?.clientHeight || 0 };
}

async function captureAllSnapshots() {
  const viewport = document.querySelector('.ag-body-viewport, .ag-center-cols-viewport');
  if (!document.querySelector('.ag-header-cell-text') || !document.querySelector('.location-schedule-employee-cell__name') || !viewport) {
    return { ok: false, code: 'SCHEDULE_NOT_READY', error: 'Open My Location Schedule, wait for employee rows, then import again.' };
  }
  const originalTop = viewport.scrollTop;
  viewport.scrollTop = 0;
  const snapshots = [];
  let previousTop = -1;
  try {
    for (let step = 0; step < 200; step += 1) {
      await pause(100);
      const snapshot = captureGrid();
      snapshots.push(snapshot);
      const atBottom = snapshot.scrollTop + snapshot.clientHeight >= snapshot.scrollHeight - 2;
      if (atBottom || snapshot.scrollTop === previousTop || !snapshot.clientHeight) break;
      previousTop = snapshot.scrollTop;
      viewport.scrollTop = Math.min(viewport.scrollHeight, viewport.scrollTop + Math.max(1, viewport.clientHeight - 40));
    }
    return { ok: true, snapshots };
  } finally {
    viewport.scrollTop = originalTop;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CAPTURE_KRONOS_GRID') return false;
  captureAllSnapshots().then(sendResponse).catch(error => sendResponse({ ok: false, code: 'EXTRACTION_FAILED', error: error.message }));
  return true;
});
