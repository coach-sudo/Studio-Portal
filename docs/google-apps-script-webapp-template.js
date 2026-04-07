var SHEET_CONFIG = {
  Students: 'students',
  Lessons: 'lessons',
  Notes: 'notes',
  Homework: 'homework',
  Packages: 'packages',
  Payments: 'payments',
  ActorProfiles: 'actorProfiles',
  Materials: 'files'
};

function doGet(e) {
  var action = '';

  if (e && e.parameter && e.parameter.action) {
    action = String(e.parameter.action).trim();
  }

  if (action === 'ping') {
    return jsonResponse({
      ok: true,
      service: 'studio-portal-sheets'
    });
  }

  if (action === 'snapshot') {
    verifyToken_(e, null);
    return jsonResponse({
      ok: true,
      snapshot: readSnapshot_()
    });
  }

  return jsonResponse({
    ok: false,
    error: 'Unsupported action.'
  });
}

function doPost(e) {
  var body = {};
  var action = '';

  if (e && e.postData && e.postData.contents) {
    body = JSON.parse(e.postData.contents);
  }

  verifyToken_(e, body);

  if (body && body.action) {
    action = String(body.action).trim();
  }

  if (action === 'push_snapshot') {
    writeSnapshot_(body.snapshot || {});
    return jsonResponse({
      ok: true,
      updatedAt: new Date().toISOString()
    });
  }

  return jsonResponse({
    ok: false,
    error: 'Unsupported action.'
  });
}

function verifyToken_(request, body) {
  var expected = PropertiesService.getScriptProperties().getProperty('STUDIO_PORTAL_TOKEN');
  var provided = '';

  if (!expected) {
    return;
  }

  if (body && body.token) {
    provided = String(body.token);
  } else if (request && request.parameter && request.parameter.token) {
    provided = String(request.parameter.token);
  } else if (request && request.headers && request.headers['X-Studio-Token']) {
    provided = String(request.headers['X-Studio-Token']);
  } else if (request && request.headers && request.headers['x-studio-token']) {
    provided = String(request.headers['x-studio-token']);
  }

  if (provided !== String(expected)) {
    throw new Error('Unauthorized.');
  }
}

function readSnapshot_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var snapshot = {};
  var sheetNames = Object.keys(SHEET_CONFIG);
  var i;

  for (i = 0; i < sheetNames.length; i += 1) {
    var sheetName = sheetNames[i];
    var collectionKey = SHEET_CONFIG[sheetName];
    var sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      snapshot[collectionKey] = [];
      continue;
    }

    var values = sheet.getDataRange().getValues();
    if (!values || !values.length) {
      snapshot[collectionKey] = [];
      continue;
    }

    var headers = values[0];
    var records = [];
    var rowIndex;

    for (rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      var row = values[rowIndex];
      var hasData = false;
      var columnIndex;
      var record = {};

      for (columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        if (String(row[columnIndex] || '').trim() !== '') {
          hasData = true;
        }
      }

      if (!hasData) {
        continue;
      }

      for (columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
        record[String(headers[columnIndex] || '').trim()] = row[columnIndex];
      }

      records.push(record);
    }

    snapshot[collectionKey] = records;
  }

  return snapshot;
}

function writeSnapshot_(snapshot) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = Object.keys(SHEET_CONFIG);
  var i;

  for (i = 0; i < sheetNames.length; i += 1) {
    var sheetName = sheetNames[i];
    var collectionKey = SHEET_CONFIG[sheetName];
    var records = snapshot && snapshot[collectionKey] && snapshot[collectionKey].length ? snapshot[collectionKey] : [];
    var sheet = spreadsheet.getSheetByName(sheetName);
    var headers;
    var values;
    var rowIndex;
    var colIndex;

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    sheet.clearContents();

    if (!records.length) {
      continue;
    }

    headers = Object.keys(records[0]);
    values = [headers];

    for (rowIndex = 0; rowIndex < records.length; rowIndex += 1) {
      var record = records[rowIndex];
      var valueRow = [];

      for (colIndex = 0; colIndex < headers.length; colIndex += 1) {
        var header = headers[colIndex];
        valueRow.push(record[header] === null || typeof record[header] === 'undefined' ? '' : record[header]);
      }

      values.push(valueRow);
    }

    sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
