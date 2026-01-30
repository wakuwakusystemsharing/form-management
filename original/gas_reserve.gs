// LINE Messaging APIのチャネルアクセストークン。これを使ってLINEのAPIにアクセスする。
const CHANNEL_ACCESS_TOKEN = 'flf43Da0X9iJQfQMy6ooDJ2mJ8gFdjpjfPNcQ59WwShIu5zNqUMJ7IjdZFE8DgQ15tRVvYbuHGhM0909rd7w1bMtmNiX8OeTHm47h81tjR/aw+oLmWT21Q+IelO+Yy9YRCKG2Y/tKYmwobW0Kc7hNgdB04t89/1O/w1cDnyilFU=';
// 使用するGoogleカレンダーのID。予約の管理に使う。
const CALENDAR_ID = '8fe1ca05d68ca0329df85338ce7b78e9c66ebb5c9c5f7e4f2fe85bfac9ef376c@group.calendar.google.com';

// この関数はPOSTリクエストを受け取った際に呼び出されます
function doPost(e) {
  try {
    // リクエストデータを解析
    const data = JSON.parse(e.postData.contents); // POSTリクエストのデータを解析
    const replyToken = data.events[0].replyToken; // 返信に必要なトークン
    const userId = data.events[0].source.userId; // ユーザーID
    const userMessage = data.events[0].message.text; // ユーザーからのメッセージ
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID); // Googleカレンダーの取得

    if (typeof replyToken === 'undefined') {
      return; // 返信トークンがない場合は終了
    }

    // チャットの「読み込み中」を開始する関数
    function startLoadingIndicator(userId) {
      var url = 'https://api.line.me/v2/bot/chat/loading/start';

      // ヘッダー設定
      var headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN
      };

      // 「読み込み中」表示のデータ
      var data = {
        "chatId": userId,
        "loadingSeconds": 5
      };

      // オプションの設定
      var options = {
        'method': 'post',
        'headers': headers,
        'payload': JSON.stringify(data)
      };

      // リクエストを送信
      UrlFetchApp.fetch(url, options);
    }

    if (userMessage === '予約確認') {
      // チャットの「読み込み中」を開始する関数を呼び出し
      startLoadingIndicator(userId);
      const now = new Date(); // 現在の日時を取得
      const events = calendar.getEvents(now, new Date('2100-12-31'), { search: userId });

      if (events.length > 0) {
        let message = [];

        // 取得した予約イベントごとに処理
        events.forEach(event => {
          const startTime = Utilities.formatDate(event.getStartTime(), 'Asia/Tokyo', 'yyyy年MM月dd日') +
            '（' +
            ['日', '月', '火', '水', '木', '金', '土'][event.getStartTime().getDay()] +
            '）' +
            Utilities.formatDate(event.getStartTime(), 'Asia/Tokyo', 'H時m分'); // イベント開始時間をフォーマット

          const description = event.getDescription(); // イベントの詳細（予約フォームの内容）を取得
          // メニューの取得
          const menuMatch = description.match(/≪メニュー≫\s*([\s\S]*?)≪/);
          const nameMatch = description.match(/≪お名前≫\s*([\s\S]*?)≪/);
          let menuText = '';
          let nameText = '';
if (menuMatch && menuMatch.length > 1) {
  menuText = menuMatch[1].trim().replace(/,/g, '\n・'); // , を改行して箇条書きに
}

          if (nameMatch && nameMatch.length > 1) {
            nameText = nameMatch[1].trim(); // 名前を取得
          }

          // メッセージの内容を作成
          message.push({
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                    {
                      type: 'text',
                      text: '機能確認用',
                      color: '#ffffff',
                      size: 'sm'
                    },
                    {
                      type: 'text',
                      text: '予約内容',
                      color: '#ffffff',
                      size: 'xl',
                      flex: 4,
                      weight: 'bold'
                    }
                  ]
                }
              ],
              paddingAll: '20px',
              backgroundColor: '#f7a3a3',
              spacing: 'md',
              height: '70px',
              paddingTop: '12px'
            },
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: `  【お名前】\n・${nameText}`, // 予約日付
                  margin: 'md',
                  wrap: true // 自動改行を有効にする
                },
                {
                  type: 'text',
                  text: `  【予約日付】\n・${startTime}`, // 予約日付
                  margin: 'md',
                  wrap: true // 自動改行を有効にする
                },
                {
                  type: 'text',
                  text: `  【メニュー】\n${menuText}`, // 予約メニュー
                  margin: 'md',
                  wrap: true // 自動改行を有効にする
                }
              ]
            }
          });
        });

        // 予約確認メッセージを送信
        replyFlexMessage(replyToken, message);
      } else {
        // 予約が見つからない場合のメッセージ
        replyFlexMessage(replyToken, [{
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '予約確認', // メッセージタイトル
                weight: 'bold',
                size: 'lg'
              },
              {
                type: 'text',
                text: '現在LINEでされた予約が見つかりませんでした。',
                margin: 'md',
                wrap: true // 自動改行を有効にする
              }
            ]
          }
        }]);
      }

    } else if (userMessage.startsWith('【予約フォーム】')) {
      // チャットの「読み込み中」を開始する関数を呼び出し
      startLoadingIndicator(userId);
      // ユーザーからのメッセージが「【予約フォーム】」で始まる場合
      const reservationDetails = parseReservationForm(userMessage);

      // 予約詳細が存在し、日付情報がある場合
      if (reservationDetails && reservationDetails.dates && reservationDetails.dates.length > 0) {
        // ユーザープロフィールを取得
        const userProfile = getUserProfile(userId);
        if (userProfile) {
          const userName = userProfile.displayName;

          // ユーザーの予約が既にあるか確認
          const now = new Date();
          const futureEvents = calendar.getEvents(now, new Date('2100-12-31'), { search: userId });
          if (futureEvents.length > 0) {
            // 既に予約がある場合のメッセージを送信
            replyFlexMessage(replyToken, [{
              type: 'bubble',
              body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '予約通知',
                    weight: 'bold',
                    size: 'lg'
                  },
                  {
                    type: 'text',
                    text: '既に予約があります。\n予約が過ぎるまで新しい予約はできません。',
                    margin: 'md',
                    wrap: true // 自動改行を有効にする
                  }
                ]
              }
            }]);
            return; // これ以上の処理を行わない
          }

          let reservationMade = false; // 予約が成功したかどうかのフラグ
          let message = []; // 返信メッセージの配列

          reservationDetails.dates.forEach(date => {
            const now = new Date();
            const oneYearLater = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()); // 現在から1年後の日時

            // 1年後の予約がある場合、メッセージを返して処理を終了
            if (date >= oneYearLater) {
              replyFlexMessage(replyToken, [{
                type: 'bubble',
                body: {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                    {
                      type: 'text',
                      text: '予約通知',
                      weight: 'bold',
                      size: 'lg'
                    },
                    {
                      type: 'text',
                      text: '1年後のご予約は受け付けておりません。',
                      margin: 'md',
                      wrap: true // 自動改行を有効にする
                    }
                  ]
                }
              }]);
              return; // これ以上の処理を行わない
            }

            // 日付から日本語の曜日を取得する関数
            function getJapaneseDayOfWeek(date) {
              const days = ['日', '月', '火', '水', '木', '金', '土']; // 日本語の曜日
              return days[date.getDay()];
            }

            // 営業時間を取得
            const businessHours = getBusinessHours(date, calendar);

            // 予約が成功していない、日付が有効、営業時間内、現在の日付より後、かつ1年以内の日付の場合
            if (!reservationMade && isValidDate(date) && isWithinBusinessHours(date, businessHours) && (businessHours || !isSunday(date)) && date > now && date < oneYearLater) {
              const endDate = new Date(date.getTime() + reservationDetails.duration * 60 * 1000); // 予約終了時間を設定
              const events = calendar.getEvents(date, endDate);

              // その時間帯にイベントが2つ未満の場合
              if (events.filter(event => event.getTitle() !== '営業日').length < 1) {
                const dayOfWeek = getJapaneseDayOfWeek(date); // 日本語の曜日を取得
                // 新しいイベントを作成
                calendar.createEvent(
                  '予約: ' + reservationDetails.name,
                  date,
                  endDate,
                  {
                    description: `≪希望日時≫ ${Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy年MM月dd日 HH:mm')}\n≪LINEの名前≫ ${userName}\n≪お名前≫ ${reservationDetails.name}\n≪電話番号≫ ${reservationDetails.phoneNumber}\n≪コース≫ \n・${reservationDetails.firstMenu}\n≪メニュー≫ \n・${reservationDetails.symptoms}\n≪ご来店回数≫ ${reservationDetails.firstVisit}\n≪メッセージ≫ \n${reservationDetails.message}`,
                    location: userId // userIdを場所に保存する
                  }
                );

                // メッセージの内容を作成
                message.push({
                  type: 'bubble',
                  size: 'mega',
                  header: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                      {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                          {
                            type: 'text',
                            text: '機能確認用',
                            color: '#ffffff',
                            size: 'sm'
                          },
                          {
                            type: 'text',
                            text: '予約通知',
                            color: '#ffffff',
                            size: 'xl',
                            flex: 4,
                            weight: 'bold'
                          }
                        ]
                      }
                    ],
                    paddingAll: '20px',
                    backgroundColor: '#f7a3a3',
                    spacing: 'md',
                    height: '70px',
                    paddingTop: '12px'
                  },
                  body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                      {
                        type: 'text',
                        text: `  【お名前】\n・${reservationDetails.name}\n\n  【メニュー】\n・${reservationDetails.symptoms.join('\n・')}\n\n  【予約日】\n・${Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy年MM月dd日')}(${dayOfWeek}) ${date.getHours()}時${date.getMinutes()}分`,
                        margin: 'md',
                        wrap: true // 自動改行を有効にする
                      },
                      {
                        "type": "separator",
                        "margin": "xxl"
                      },
                      {
                        type: 'text',
                        text: `予約完了いたしました。\nご来店心よりお待ちしております。`,
                        margin: 'md',
                        wrap: true // 自動改行を有効にする
                      }
                    ]
                  }
                });

                // 予約が成功したことを示す
                reservationMade = true;
              }
            }
          });

          // 予約が成功しなかった場合のメッセージを送信
          if (!reservationMade) {
            replyFlexMessage(replyToken, [{
              type: 'bubble',
              body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '予約通知',
                    weight: 'bold',
                    size: 'lg'
                  },
                  {
                    type: 'text',
                    text: '全ての希望日時が埋まっています。\n他の日付をお試しください。',
                    margin: 'md',
                    wrap: true // 自動改行を有効にする
                  }
                ]
              }
            }]);
          } else {
            // 予約成功のメッセージを送信
            replyFlexMessage(replyToken, message);
          }
        } else {
          // ユーザープロフィールが取得できなかった場合のメッセージを送信
          replyFlexMessage(replyToken, [{
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: '予約フォーム',
                  weight: 'bold',
                  size: 'lg',
                  wrap: true // 自動改行を有効にする
                },
                {
                  type: 'text',
                  text: 'ユーザープロフィールの取得に失敗しました。',
                  margin: 'md',
                  wrap: true // 自動改行を有効にする
                }
              ]
            }
          }]);
        }
      } else {
        // 予約詳細に不足がある場合のメッセージを送信
        replyFlexMessage(replyToken, [{
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '予約フォーム',
                weight: 'bold',
                size: 'lg',
                wrap: true // 自動改行を有効にする
              },
              {
                type: 'text',
                text: '情報に不足があります。\nすべての必須項目を入力してください。',
                margin: 'md',
                wrap: true // 自動改行を有効にする
              }
            ]
          }
        }]);
      }

    } else if (userMessage === '予約をキャンセル') {
      // チャットの「読み込み中」を開始する関数を呼び出し
      startLoadingIndicator(userId);
      // 現在の日付と時刻を取得
      const now = new Date();
      // 現在から2100年12月31日までのユーザーの予約を検索
      const futureEvents = calendar.getEvents(now, new Date('2100-12-31'), { search: userId });

      // 予約があるか確認
      if (futureEvents.length > 0) {
        // 予約の一覧を作成
        let eventList = [];
        futureEvents.forEach((event, index) => {
          const startTime = event.getStartTime();
          const formattedStartTime = Utilities.formatDate(event.getStartTime(), 'Asia/Tokyo', 'yyyy年MM月dd日') +
            '（' +
            ['日', '月', '火', '水', '木', '金', '土'][event.getStartTime().getDay()] +
            '）' +
            Utilities.formatDate(event.getStartTime(), 'Asia/Tokyo', 'H時m分'); // イベント開始時間をフォーマット

          const description = event.getDescription(); // イベントの詳細（予約フォームの内容）を取得
          // メニューの取得

          const menuMatch = description.match(/≪メニュー≫\s*([\s\S]*?)≪/);
          let menuText = '';
if (menuMatch && menuMatch.length > 1) {
  menuText = menuMatch[1].trim().replace(/,/g, '\n・'); // , を改行して箇条書きに
}

          // 各ボタンの前に日付テキストを追加
          eventList.push({
            type: 'text',
            text: `  【予約日付】\n・${formattedStartTime}\n\n  【メニュー】\n${menuText}\n`,
            margin: 'md',
            wrap: true
          });

          eventList.push({
            type: 'button',
            action: {
              type: 'message',
              label: `予約 ${index + 1}をキャンセルする`,
              text: `キャンセル: ${index}`
            },
            color: '#17c950', // 緑色
            style: 'primary'
          });
        });

        // ボタンの下に説明テキストを追加
        eventList.push({
          type: 'text',
          text: '↑タップしてください',
          size: 'sm',
          color: '#333333', // 黒に近い色
          margin: 'lg', // 少し下に配置
          align: 'center', // 中央ぞろい
          wrap: true
        });

        // ユーザーに予約一覧を表示
        replyFlexMessage(replyToken, [{
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '機能確認用',
                    color: '#ffffff',
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: '予約をキャンセル',
                    color: '#ffffff',
                    size: 'xl',
                    flex: 4,
                    weight: 'bold'
                  }
                ]
              }
            ],
            paddingAll: '20px',
            backgroundColor: '#f7a3a3',
            spacing: 'md',
            height: '70px',
            paddingTop: '12px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '　　【ご予約された予約内容】',
                margin: 'md',
                wrap: true
              },
              {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: eventList
              }
            ]
          }
        }]);
      } else {
        // キャンセルする予約がない場合のメッセージを送信
        replyFlexMessage(replyToken, [{
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '予約をキャンセル',
                weight: 'bold',
                size: 'lg'
              },
              {
                type: 'text',
                text: '現在LINEでされた予約がありません。',
                margin: 'md',
                wrap: true
              }
            ]
          }
        }]);
      }
    } else if (userMessage.startsWith('キャンセル: ')) {
      // キャンセルする予約のインデックスを取得
      const eventIndex = parseInt(userMessage.replace('キャンセル: ', ''));
      // 現在の日付と時刻を取得
      const now = new Date();
      // 現在から2100年12月31日までのユーザーの予約を検索
      const futureEvents = calendar.getEvents(now, new Date('2100-12-31'), { search: userId });

      if (futureEvents[eventIndex]) {
        const event = futureEvents[eventIndex];
        const startTime = event.getStartTime();
        const timeDifference = startTime - now;

        // 予約の開始時間が24時間以上先の場合
        if (timeDifference > 24 * 60 * 60 * 1000) {
          event.deleteEvent();
          const formattedCancelledEvent = Utilities.formatDate(startTime, 'Asia/Tokyo', 'MM月dd日 HH:mm');
          replyFlexMessage(replyToken, [{
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: '予約をキャンセル',
                  weight: 'bold',
                  size: 'lg'
                },
                {
                  type: 'text',
                  text: `${formattedCancelledEvent}の\n予約をキャンセルしました。`,
                  margin: 'md',
                  wrap: true
                }
              ]
            }
          }]);
        } else {
          replyFlexMessage(replyToken, [{
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: '予約をキャンセル',
                  weight: 'bold',
                  size: 'lg'
                },
                {
                  type: 'text',
                  text: '24時間以内の予約はキャンセルできません。\n変更をご希望の方は右上の\nLINEコールかチャットでお問い合わせください',
                  margin: 'md',
                  wrap: true
                }
              ]
            }
          }]);
        }
      } else {
        replyFlexMessage(replyToken, [{
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '予約をキャンセル',
                weight: 'bold',
                size: 'lg'
              },
              {
                type: 'text',
                text: '指定された予約が見つかりません。',
                margin: 'md',
                wrap: true
              }
            ]
          }
        }]);
      }
    } else {
      // それ以外のメッセージには返信しない
      return;
    }
  } catch (error) {
    // エラーが発生した場合の処理
    Logger.log('エラーが発生しました: ' + error.message);
    // サーバーエラーのメッセージを送信
    replyFlexMessage(replyToken, [{
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'サーバーエラー',
            weight: 'bold',
            size: 'lg',
            wrap: true // 自動改行を有効にする
          },
          {
            type: 'text',
            text: 'サーバーエラーが発生しました。\n後ほど再度お試しください。',
            margin: 'md',
            wrap: true // 自動改行を有効にする
          }
        ]
      }
    }]);
  }
}

function parseReservationForm(message) {
  // 受け取ったメッセージを改行で分割して配列に変換
  const lines = message.split('\n');
  // 予約の詳細を格納するオブジェクトを初期化
  const details = {
    dates: [],
    symptoms: '',
    firstMenu: '',
    firstVisit: '',
    reservation: '',
    message: '',
    duration: 0 // デフォルトは2時間（120分）
  };

  try {
    // 次の行が日付かどうかを示すフラグ
    let nextLineIsDate = false;

    // 各行をループして予約情報を抽出
    lines.forEach(line => {
      if (line.startsWith('お名前：')) {
        // お名前の行を処理
        details.name = line.replace('お名前：', '').trim();
      } else if (line.startsWith('電話番号：')) {
        // 電話番号の行を処理
        details.phoneNumber = line.replace('電話番号：', '').trim();
      } else if (line.startsWith('メニュー：')) {
        // メニューの行を処理
        details.symptoms = line.replace('メニュー：', '').trim().split(',').map(item => item.trim());

        // 初期の予約時間を設定
        details.symptoms.forEach(symptom => {
          if (symptom === 'コースA（1000円/30分）') {
            details.duration = 30;
          } else if (symptom === 'コースB（2000円/60分）') {
            details.duration = 60;
          } else if (symptom === 'コースC（3000円/90分）') {
            details.duration = 90;
          } else if (symptom === 'コースD（4000円/120分）') {
            details.duration = 120;
          }

          // オプションによる時間の追加
          const optionDurations = {
            'オプションA（1000円/10分）': 10,
            'オプションA（1000円/10分）': 10,
            'オプションB（2000円/20分）': 20,
            'オプションC（3000円/30分）': 30
          };

          // オプションが完全に一致した場合のみ時間を追加
          if (optionDurations[symptom] !== undefined) {
            details.duration += optionDurations[symptom];
          }
        });

      } else if (line.startsWith('ご来店回数：')) {
        // 来店回数の行を処理
        details.firstVisit = line.replace('ご来店回数：', '').trim();
      } else if (line.startsWith('コース：')) {
        // 来店回数の行を処理
        details.firstMenu = line.replace('コース：', '').trim();
      } else if (line.startsWith('希望日時：')) {
        // 希望日時の行を処理
        nextLineIsDate = true;
      } else if (nextLineIsDate && line.trim() !== '' && !line.startsWith('メッセージ：')) {
        // 希望日時の次の行を日付として処理
        const dateTimeStr = line.trim();
        const dateTime = parseDateTime(dateTimeStr);
        if (!isNaN(dateTime.getTime())) {
          details.dates.push(dateTime);
        }
      } else if (line.startsWith('メッセージ：')) {
        // メッセージの行を処理（改行対応）
        details.message = line.replace('メッセージ：', '').trim();
        let messageIndex = lines.indexOf(line) + 1;
        while (messageIndex < lines.length && lines[messageIndex].trim() !== '') {
          details.message += '\n' + lines[messageIndex].trim();
          messageIndex++;
        }
        nextLineIsDate = false;
      }
    });

    // 日付がない場合はエラーをスロー
    if (!details.dates.length) {
      throw new Error('必須項目が入力されていません。');
    }

    // 抽出した予約情報を返す
    return details;
  } catch (error) {
    // エラーログを記録し、nullを返す
    Logger.log('予約フォームのパースエラー: ' + error.message);
    return null;
  }
}

function parseDateTime(dateTimeStr) {
  try {
    // 日付文字列を正規表現で解析
    const match = dateTimeStr.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日 (\d{1,2}):(\d{2})$/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 月は0から始まるため、1を引く
      const day = parseInt(match[3], 10);
      const hour = parseInt(match[4], 10);
      const minute = parseInt(match[5], 10);

      // 日付オブジェクトを返す
      return new Date(year, month, day, hour, minute);
    }
    // 無効な日付形式の場合はエラーをスロー
    throw new Error('日付形式が無効です: ' + dateTimeStr);
  } catch (error) {
    // エラーログを記録し、NaNを返す
    Logger.log('日付解析エラー: ' + error.message);
    return NaN;
  }
}

function isValidDate(date) {
  // 日付オブジェクトが有効かどうかをチェック
  return date instanceof Date && !isNaN(date.getTime());
}

// Google Calendarから特定の日に「営業日」というイベントがあるかどうかを確認
function getBusinessHours(date, calendar) {
  const events = calendar.getEventsForDay(date);
  for (let i = 0; i < events.length; i++) {
    if (events[i].getTitle() === '営業日') {
      // 営業日のイベントの開始時間と終了時間を取得
      const startTime = events[i].getStartTime();
      const endTime = events[i].getEndTime();
      return {
        start: startTime,
        end: endTime
      };
    }
  }
  return null; // 「営業日」のイベントがない場合はnullを返す
}

function isWithinBusinessHours(date, businessHours) {
  if (!isValidDate(date)) {
    return false;
  }

  if (businessHours) {
    // 営業日の営業時間内かどうかをチェック
    const startTime = businessHours.start;
    const endTime = businessHours.end;
    return date >= startTime && date <= endTime;
  }

  // 通常の営業時間を定義
  const businessHoursByDay = {
    0: { openingHour: 3, openingMinute: 0, closingHour: 22, closingMinute: 0 }, // 日曜日
    1: { openingHour: 3, openingMinute: 0, closingHour: 22, closingMinute: 0 }, // 月曜日
    2: { openingHour: 3, openingMinute: 0, closingHour: 22, closingMinute: 0 }, // 火曜日
    3: { openingHour: 3, openingMinute: 0, closingHour: 22, closingMinute: 0 }, // 水曜日
    4: { openingHour: 3, openingMinute: 0, closingHour: 22, closingMinute: 0 }, // 木曜日
    5: { openingHour: 3, openingMinute: 0, closingHour: 22, closingMinute: 0 }, // 金曜日
    6: { openingHour: 3, openingMinute: 0, closingHour: 22, closingMinute: 0 }, // 土曜日
  };

  // 日付から曜日を取得
  const day = date.getDay();
  const hours = date.getHours();
  const minutes = date.getMinutes();

  // 当該曜日の営業時間を取得
  const { openingHour, openingMinute, closingHour, closingMinute } = businessHoursByDay[day];

  // 営業時間内かどうかをチェック
  const isAfterOpening = hours > openingHour || (hours === openingHour && minutes >= openingMinute);
  const isBeforeClosing = hours < closingHour || (hours === closingHour && minutes < closingMinute);

  // 12時から13時までを休憩時間とする
  const isLunchBreak = (hours === 23 && minutes >= 0 && minutes < 60);

  return isAfterOpening && isBeforeClosing && !isLunchBreak;
}

function isSunday(date) {
  if (!isValidDate(date)) {
    return false;
  }

  // 常に false を返す
  return false;
}

function getUserProfile(userId) {
  try {
    // ユーザープロフィールを取得するためのURLを作成
    const url = `https://api.line.me/v2/bot/profile/${userId}`;
    const response = UrlFetchApp.fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN,
      }
    });
    if (response.getResponseCode() === 200) {
      // レスポンスが成功した場合、JSONをパースしてユーザープロフィールを返す
      return JSON.parse(response.getContentText());
    } else {
      // エラーログを記録し、nullを返す
      Logger.log('ユーザープロフィール取得エラー: ' + response.getResponseCode());
      return null;
    }
  } catch (error) {
    // エラーログを記録し、nullを返す
    Logger.log('ユーザープロフィール取得エラー: ' + error.message);
    return null;
  }
}

function replyFlexMessage(replyToken, bubbles) {
  try {
    // フレックスメッセージを送信するためのAPIエンドポイント
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN,
      },
      method: 'post',
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{
          type: 'flex',
          altText: '予約情報',
          contents: {
            type: 'carousel',
            contents: bubbles
          }
        }]
      }),
    });
  } catch (error) {
    // エラーログを記録
    Logger.log('返信メッセージ送信エラー: ' + error.message);
  }
}
