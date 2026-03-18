// Googleカレンダーの情報を取得してJSONで返すエンドポイント関数
function doGet(e) {
  try {
    var calendarId = '8fe1ca05d68ca0329df85338ce7b78e9c66ebb5c9c5f7e4f2fe85bfac9ef376c@group.calendar.google.com'; // 予約を管理するカレンダーID

    // パラメータが存在するか確認
    if (!e || !e.parameter) {
      return createErrorResponse('No parameters provided.'); // エラーレスポンスを返す
    }

    // 必須パラメータの取得（開始・終了時間）
    const { startTime, endTime } = e.parameter;

    // パラメータのバリデーション
    if (typeof startTime !== 'string' || typeof endTime !== 'string') {
      return createErrorResponse('Invalid parameter types. Expected strings.'); // 型のチェック
    }

    if (!startTime || !endTime) {
      return createErrorResponse('Missing startTime or endTime parameter.'); // エラーレスポンスを返す
    }

    // 日付フォーマットが正しいか確認
    if (!isValidISODate(startTime) || !isValidISODate(endTime)) {
      return createErrorResponse('Invalid date format.'); // エラーレスポンスを返す
    }

    // タイムゾーンの確認とフォールバック
    const timeZone = getTimeZone('Asia/Tokyo'); // デフォルトのタイムゾーンは日本標準時
    const start = new Date(new Date(startTime).toLocaleString('en-US', { timeZone }));
    const end = new Date(new Date(endTime).toLocaleString('en-US', { timeZone }));

    // 過去1か月前の日付を計算
    const oneMonthAgo = new Date(start);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    logInfo(`Fetching events from ${oneMonthAgo} to ${end} with timezone ${timeZone}`);

    // カレンダーAPIからイベントを取得
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) {
      return createErrorResponse('Calendar not found.'); // エラーレスポンスを返す
    }

    // イベント取得のリトライとエラーハンドリング
    let events;
    try {
      const maxRetries = 3;  // リトライ回数を外部から柔軟に設定可能にする
      events = fetchEventsWithRetry(calendar, oneMonthAgo, end, maxRetries); // リトライ付きのイベント取得関数
    } catch (calendarError) {
      sendErrorNotification(calendarError.message); // エラー通知を送信
      return createErrorResponse('Error fetching events from the calendar.'); // エラーレスポンスを返す
    }

    // イベントが見つからなかった場合のログ出力
    if (events.length === 0) {
      logInfo('No events found for the given time range.');
    }

    // 取得したイベントを整形
    const availability = events.map(event => {
      return {
        title: event.getTitle() || 'No title',
        startTime: event.getStartTime().toISOString(),
        endTime: event.getEndTime().toISOString(),
        location: event.getLocation() || 'No location',
        description: event.getDescription() || 'No description',
        isBusinessDay: event.getTitle() ? event.getTitle().includes('営業日') : false
      };
    });

    // レスポンスをJSON形式で返却
    const jsonOutput = JSON.stringify(availability);
    return ContentService.createTextOutput(jsonOutput).setMimeType(ContentService.MimeType.JSON); // JSONレスポンスを返す

  } catch (error) {
    sendErrorNotification(error.stack); // エラーログに詳細なスタックトレースを含める
    return createErrorResponse('An unexpected error occurred.'); // エラーレスポンスを返す
  }
}

// リトライ付きのイベント取得関数
function fetchEventsWithRetry(calendar, start, end, maxRetries) {
  let attempts = 0;
  const backoffTime = 1000; // 1秒

  while (attempts < maxRetries) {
    try {
      const events = calendar.getEvents(start, end) || []; // カレンダーからイベントを取得し、なければ空配列を返す
      return events;
    } catch (error) {
      logInfo(`Attempt ${attempts + 1} failed: ${error.message}`);
      if (attempts >= maxRetries - 1) {
        throw new Error('Failed to fetch events after multiple attempts: ' + error.message);
      }
      Utilities.sleep(backoffTime * Math.pow(2, attempts)); // 指数バックオフ
      attempts++;
    }
  }
}

// 日付フォーマットがISO 8601形式であるか検証
function isValidISODate(dateString) {
  const isoFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/; // ISO 8601形式
  return isoFormat.test(dateString); // パターンマッチで検証
}

// タイムゾーンのフォールバックを含めた取得関数
function getTimeZone(defaultTimeZone) {
  try {
    return Session.getScriptTimeZone() || defaultTimeZone;
  } catch (error) {
    logInfo(`Invalid timezone. Falling back to default: ${defaultTimeZone}`);
    return defaultTimeZone;
  }
}

// エラーレスポンスを作成する関数
function createErrorResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({ error: message }))
    .setMimeType(ContentService.MimeType.JSON); // エラーレスポンスをJSON形式で返す
}

// エラーログを外部システムへ通知（例: Slack, Email）
function sendErrorNotification(message) {
  Logger.log('[ERROR NOTIFICATION] ' + message); // 本番環境では外部通知を使用
}

// 情報ログを記録する関数
function logInfo(message) {
  Logger.log('[INFO] ' + message); // 必要な情報をログに記録
}
