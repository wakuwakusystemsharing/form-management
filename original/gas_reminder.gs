function sendReminderMessages() {
  const calendarId = "8fe1ca05d68ca0329df85338ce7b78e9c66ebb5c9c5f7e4f2fe85bfac9ef376c@group.calendar.google.com"; // GoogleカレンダーID
  const now = new Date();

  // 翌日の8時～21時の時間範囲を設定
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startTime = new Date(tomorrow.setHours(8, 0, 0)); // 翌日8時
  const endTime = new Date(tomorrow.setHours(21, 0, 0)); // 翌日21時

  // カレンダーからイベントを取得（翌日の8時～21時の範囲）
  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    console.error("指定したカレンダーIDが見つかりません。");
    return;
  }

  const events = calendar.getEvents(startTime, endTime);
  if (events.length === 0) {
    console.log("対象のイベントがありません。");
    return;
  }

  // LINE Messaging API用設定
  const LINE_CHANNEL_ACCESS_TOKEN = "flf43Da0X9iJQfQMy6ooDJ2mJ8gFdjpjfPNcQ59WwShIu5zNqUMJ7IjdZFE8DgQ15tRVvYbuHGhM0909rd7w1bMtmNiX8OeTHm47h81tjR/aw+oLmWT21Q+IelO+Yy9YRCKG2Y/tKYmwobW0Kc7hNgdB04t89/1O/w1cDnyilFU=";
  const LINE_API_URL = "https://api.line.me/v2/bot/message/push";

  events.forEach(event => {
    const userId = event.getLocation(); // ユーザーIDを場所欄から取得
    if (userId) {
      const description = event.getDescription() || '';

      const menuMatch = description.match(/≪メニュー≫\s*([\s\S]*?)≪/);
      const menuText = menuMatch ? menuMatch[1].trim() : '未設定';

      const dateTime = event.getStartTime();
      const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
      const dateText = Utilities.formatDate(dateTime, Session.getScriptTimeZone(), "yyyy年MM月dd日") + "（" + weekdays[dateTime.getDay()] + "） " + Utilities.formatDate(dateTime, Session.getScriptTimeZone(), "HH時mm分");

      // Flexメッセージ作成
      const flexMessage = {
        type: 'flex',
        altText: 'リマインドメッセージ',
        contents: {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '店舗',
                color: '#ffffff66',
                size: 'sm'
              },
              {
                type: 'text',
                text: '【予約前日メッセージ】',
                color: '#ffffff',
                size: 'xl',
                weight: 'bold'
              }
            ],
            paddingAll: '20px',
            backgroundColor: '#877059'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '明日の予約をお知らせします',
                weight: 'bold',
                size: 'lg',
                color: '#333333',
                wrap: true,
                align: 'center',
                margin: 'md'
              },
              {
                type: 'separator',
                margin: 'lg',
                color: '#CCCCCC'
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '📅 日時',
                    color: '#666666',
                    size: 'sm',
                    weight: 'bold',
                    margin: 'md'
                  },
                  {
                    type: 'text',
                    text: dateText,
                    wrap: true,
                    size: 'sm',
                    color: '#333333',
                    margin: 'xs'
                  },
                  {
                    type: 'text',
                    text: '📝 メニュー',
                    color: '#666666',
                    size: 'sm',
                    weight: 'bold',
                    margin: 'lg'
                  },
                  {
                    type: 'text',
                    text: menuText,
                    wrap: true,
                    size: 'sm',
                    color: '#333333',
                    margin: 'xs'
                  }
                ],
                margin: 'lg'
              },
              {
                type: 'separator',
                margin: 'xxl',
                color: '#CCCCCC'
              },
              {
                type: 'text',
                text: '心よりお待ちしております',
                wrap: true,
                margin: 'xl',
                size: 'sm',
                align: 'center',
                color: '#474646'
              }
            ]
          }

        }
      };

      // メッセージ送信
      const payload = {
        to: userId,
        messages: [flexMessage]
      };

      const options = {
        method: "post",
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        },
        payload: JSON.stringify(payload)
      };

      try {
        const response = UrlFetchApp.fetch(LINE_API_URL, options);
        if (response.getResponseCode() === 200) {
          console.log(`送信成功: ${userId}にリマインドメッセージを送信しました`);
        } else {
          console.log(`送信失敗: ${response.getContentText()}`);
        }
      } catch (e) {
        console.error(`エラー発生: ${e.message}`);
      }
    }
  });
}
