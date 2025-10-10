/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId');
    const { formId } = await params;
    
    if (!storeId || !formId) {
      return NextResponse.json(
        { error: 'storeId and formId are required' },
        { status: 400 }
      );
    }

    // フォームデータを取得
    const formsPath = join(process.cwd(), 'data', 'forms.json');
    if (!existsSync(formsPath)) {
      return NextResponse.json(
        { error: 'Forms data not found' },
        { status: 404 }
      );
    }

    const formsData = JSON.parse(readFileSync(formsPath, 'utf8'));
    const form = formsData.find((f: any) => f.id === formId && f.store_id === storeId);

    if (!form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      );
    }

    // プレビューでは下書きがあれば下書きを使用
    const previewForm = {
      ...form,
      config: form.draft_config || form.config
    };

    // 静的HTMLを生成（同じ関数を使用）
    const staticHtml = generateStaticFormHTML(previewForm);
    
    return new NextResponse(staticHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('Deploy preview error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function generateStaticFormHTML(form: any): string {
  // 基本的な静的HTMLテンプレート（deploy/route.tsと同じ関数）
  return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${form.config.basic_info.form_name}</title>
    <script src="https://kit.fontawesome.com/a076d05399.js" crossorigin="anonymous"></script>
    <style>
        /* 右端の細いナビ（固定） */
        .side-nav {
            position: fixed;
            /* 画面スクロールしても固定 */
            right: -5px;
            /* さらに右へ */
            top: 80%;
            /* 画面中央に固定 */
            transform: translateY(-50%) translateX(10px);
            /* 中央配置と右ずらし */
            background: #13ca5e;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 4px;
            border-radius: 10px 0 0 10px;
            z-index: 1000;
            width: 35px;
            /* さらに細く */
        }

        .side-nav a:active {
            transform: scale(1.0);
            /* タップした後に元のサイズに戻す */
        }

        .side-nav a {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            text-decoration: none;
            font-size: 10px;
            margin: 5px 0;
            padding: 5px;
            transition: background 0.3s, transform 0.2s;
            border-radius: 5px;
            width: 30px;
            height: 30px;
            text-align: center;
        }

        .side-nav a span {
            font-size: 24px;
            /* 矢印をさらに大きく */
            position: absolute;
            left: 2px;
            /* 左端に寄せる */
            top: 13px;
            /* さらに下へ */
        }

        /* スマホ用の微調整 */
        @media (max-width: 600px) {
            .side-nav {
                right: 2px;
                /* スマホではさらに右端に */
                width: 30px;
                /* もっと細く */
            }

            .side-nav a {
                width: 28px;
                height: 28px;
            }

            .side-nav a i {
                font-size: 12px;
                /* スマホではもっと小さく */
            }
        }

        body {
            font-family: 'Poppins', sans-serif;
            background-color: #ffffff;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            height: 100vh;
            margin: 0;
            padding-top: 5px;
            overflow-x: hidden;
        }

        .container {
            background-color: #fdfdfd;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
            width: 90%;
            max-width: 500px;
            padding: 25px;
            box-sizing: border-box;
            margin: 0 auto;
        }

        h1 {
            background: linear-gradient(135deg, #13ca5e, #13ca5e);
            color: white;
            padding: 20px;
            border-radius: 0 0px 0px 0px;
            text-align: center;
            display: block;
            margin: -20px -15px 20px -15px;
            font-size: 26px;
            font-weight: 100;
            box-shadow: inset 0 -5px 10px rgba(0, 0, 0, 0.05);
            position: relative;
            overflow: hidden;
        }

        .label {
            display: block;
            margin-bottom: 20px;
            padding: 3px;
            font-weight: 400;
            background-color: #13ca5e;
            color: #ffffff;
            border-radius: 0px;
            font-size: 18px;
            text-align: center;
            text-indent: 20px;
            position: relative;
            overflow: hidden;
            border-top: 1px solid black;
            /* 上の線 */
            border-bottom: 1px solid black;
            /* 下の線 */
        }

        .labeltyuuou {
            display: block;
            margin-bottom: 20px;
            padding: 3px;
            background-color: #13ca5e;
            color: #ffffff;
            border-radius: 0px;
            font-size: 18px;
            text-align: center;
            text-indent: 0px;
            position: relative;
            overflow: hidden;
            border-top: 1px solid black;
            /* 上の線 */
            border-bottom: 1px solid black;
            /* 下の線 */
        }

        .labelContent {
            display: block;
            margin-bottom: 10px;
            padding: 3px;
            font-weight: 400;
            background-color: #ffffff;
            color: rgb(20, 20, 20);
            border-radius: 0px;
            font-size: 18px;
            text-align: center;
            text-indent: 0px;
            position: relative;
            overflow: hidden;
            border-top: 1px solid black;
            /* 上の線 */
            border-bottom: 1px solid black;
            /* 下の線 */
        }

        /* 必須マークのスタイル */
        .required {
            color: #ffffff;
            /* ゴールド（黄色） */
            font-weight: lighter;
            /* 文字を細くする */
            font-size: 0.6em;
            margin-left: 5px;
            vertical-align: 0.8em;
            /* 位置を少し上に調整 */

            /* 白色背景の四角形 */
            background-color: rgb(255, 15, 15);
            padding: 0 5px;
            border-radius: 3px;
            margin-right: 5px;
        }

        input[type="text"],
        input[type="tel"],
        textarea {
            width: 100%;
            padding: 12px;
            margin-bottom: 10px;
            border: 1px solid #555555;
            border-radius: 3px;
            box-sizing: border-box;
            font-size: 16px;
            transition: all 0.3s;
            position: relative;
            top: -5px;
        }

        .visit-buttons,
        .symptoms,
        .menu-sections,
        .irradiations {
            display: block;
            /* ボタンを縦並びに */
        }

        .visit-buttons button,
        .symptoms button,
        .menu-sections button,
        .irradiations button {
            display: block;
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            border: 1px solid #000000;
            border-radius: 4px;
            background-color: #ffffff;
            cursor: pointer;
            box-sizing: border-box;
            text-align: center;
            white-space: nowrap;
        }

        .visit-buttons button.active,
        .symptoms button.active,
        .menu-sections button.active,
        .irradiations button.active {
            background-color: ${form.config.basic_info.theme_color};
            color: white;
            border-color: ${form.config.basic_info.theme_color};
        }

        .submit-button {
            width: 100%;
            padding: 15px;
            font-size: 18px;
            background-color: #13ca5e;
            margin-top: 12px;
            border: none;
            border-radius: 6px;
            color: white;
            cursor: pointer;
        }

        .calendar-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            position: relative;
            width: 100%;
        }

        .calendar {
            flex: 1;
            background-color: #fff;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            width: 100%;
        }

        .calendar table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }

        .calendar th,
        .calendar td {
            font-size: 12.5px;
            text-align: center;
            padding: 5px;
            cursor: pointer;
            vertical-align: top;
            width: auto;
            box-sizing: border-box;
            border: 1px solid #1a1a1a;
        }

        .calendar th:first-child,
        .calendar td:first-child {
            width: 17%;
            background-color: #f9f9f9;
            font-weight: bold;
        }

        .info-text {
            position: relative;
            top: -20px;
            margin-top: 0;
            margin-bottom: 0px;
            font-size: 13px;
            color: #000000;
            line-height: 1.5;
            text-align: center;
            word-wrap: break-word;
            background-color: #f3f3f3;
            padding: 0px;
            border-radius: 0 0 4px 4px;
            border: 1px solid black;
            border-top: none;
        }

        .menu-section {
            display: none;
        }

        .menu-section.active {
            display: block;
        }

        .highlight-background {
            cursor: pointer;
            background-color: #13ca5e;
            padding: 10px;
            border-radius: 6px;
            font-size: 18px;
            font-weight: 600;
            color: white;
            text-align: center;
            position: relative;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .week-button-container {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 5px 0;
        }

        .week-button {
            background: linear-gradient(135deg, #1a1a1a, #333333);
            color: white;
            border: none;
            padding: 8px 16px;
            margin: 0 5px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .month-button-container {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 10px 0 5px 0;
        }

        .month-button {
            background: linear-gradient(135deg, #13ca5e, #0ea849);
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 0 8px;
            border-radius: 25px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            transition: all 0.3s ease;
            box-shadow: 0 4px 8px rgba(19, 202, 94, 0.3);
        }

        /* カレンダー表示制御 */
        #calendar-wrapper {
            display: none;
        }
        
        #calendar-wrapper.show {
            display: block;
        }
        
        /* 情報表示エリア */
        .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 10px 0;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 5px;
        }
        
        hr {
            margin: 5px 0;
            border: none;
            border-top: 1px solid #ddd;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${form.config.basic_info.form_name}<br>予約フォーム</h1>

        <div class="label">お客様名<span class="required">必須</span></div>
        <input type="text" id="name" placeholder="お名前を入力してください" oninput="saveInput('name')">

        <div class="label">電話番号<span class="required">必須</span></div>
        <input type="tel" id="phone" placeholder="電話番号を入力してください" oninput="saveInput('phone')">

        <div class="label">ご来店回数<span class="required">必須</span></div>
        <div class="visit-buttons">
            <button type="button" id="firstVisit" onclick="selectVisit(this)">1回目（30分）</button>
            <button type="button" id="repeatVisit" onclick="selectVisit(this)">2回目以降（0分）</button>
        </div>

        <div class="label" id="course">メニューをお選びください<span class="required">必須</span></div>
        <div class="info-text">※メニューを選択すると<br>空き状況のカレンダーが表示されます</div>
        ${form.config.menu_structure.structure_type === 'simple' ? `
            <!-- シンプル構造のメニュー表示 -->
            <div class="symptoms">
                ${(form.config.menu_structure.menus || []).map((menu: any, menuIndex: number) => {
                    if (menu.has_submenu && menu.sub_menu_items) {
                        return menu.sub_menu_items.map((item: any, itemIndex: number) => `
                            <button type="button" onclick="selectSymptom(this, 'treatment_${menuIndex}_${itemIndex}')" data-price="${item.price || 0}" data-duration="${item.duration || 0}">${menu.name} - ${item.name}（${item.price || 0}円/${item.duration || 0}分）</button>
                        `).join('');
                    } else {
                        return `
                            <button type="button" onclick="selectSymptom(this, 'treatment_${menuIndex}')" data-price="${menu.price || 0}" data-duration="${menu.duration || 0}">${menu.name}（${menu.price || 0}円/${menu.duration || 0}分）</button>
                        `;
                    }
                }).join('')}
            </div>
            
            <!-- カレンダーはメニュー選択後に表示（JavaScript制御） -->
            <div id="calendar-section" style="display: none;">
        ` : `
            <!-- カテゴリー構造のメニュー表示 -->
            <div class="menu-sections">
                ${form.config.menu_structure.categories.map((category: any) => `
                    <button type="button" onclick="showMenu('${category.name.toLowerCase().replace(/[^a-z0-9]/g, '')}')">${category.name}</button>
                `).join('')}
            </div>

            <div id="treatment-text" style="display: none; margin-bottom: 10px;"></div>

            ${form.config.menu_structure.categories.map((category: any, index: number) => `
                <div id="${category.name.toLowerCase().replace(/[^a-z0-9]/g, '')}" class="menu-section">
                    <div class="highlight-background">
                        <span class="highlight-text">◆${category.name}◆</span>
                    </div>
                    <div class="symptoms">
                        ${(category.menus || []).map((menu: any, menuIndex: number) => {
                            if (menu.has_submenu && menu.sub_menu_items) {
                                return menu.sub_menu_items.map((item: any, itemIndex: number) => `
                                    <button type="button" onclick="selectSymptom(this, 'treatment${index}_${menuIndex}_${itemIndex}')" data-price="${item.price || 0}">${menu.name} - ${item.name}（${item.price || 0}円/${item.duration || 0}分）</button>
                                `).join('');
                            } else {
                                return `
                                    <button type="button" onclick="selectSymptom(this, 'treatment${index}_${menuIndex}')" data-price="${menu.price || 0}">${menu.name}（${menu.price || 0}円/${menu.duration || 0}分）</button>
                                `;
                            }
                        }).join('')}
                    </div>
                    <div class="highlight-background">
                        <span class="highlight-text">オプション</span>
                    </div>
                    <div class="irradiations">
                        <button type="button" id="firstirradiations" onclick="selectirradiations(this)" data-price="1000">オプションA（1000円/10分）</button>
                        <button type="button" id="repeatirradiations" onclick="selectirradiations(this)" data-price="2000">オプションB（2000円/20分）</button>
                        <button type="button" id="sanirradiations" onclick="selectirradiations(this)" data-price="3000">オプションC（3000円/30分）</button>
                    </div>
                </div>
            `).join('')}
        `}

        ${form.config.menu_structure.structure_type === 'simple' ? `
            </div> <!-- calendar-section 閉じタグ -->
        ` : ''}
        
        <div class="label">希望日時<span class="required">必須</span></div>
        <div class="calendar-container"${form.config.menu_structure.structure_type === 'simple' ? ' id="calendar-wrapper" style="display: none;"' : ''}>
            <!-- 月を独立して配置 -->
            <div class="current-month-container">
                <span class="current-month" id="currentMonth">月</span>
            </div>

            <!-- 月移動ボタンを週移動ボタンの上に配置 -->
            <div class="month-button-container">
                <button class="month-button" onclick="previousmonth()">前月</button>
                <button class="month-button" onclick="nextmonth()">翌月</button>
            </div>

            <div class="week-button-container">
                <button class="week-button" onclick="previousWeek()">前週</button>
                <button class="week-button" onclick="nextWeek()">翌週</button>
            </div>

            <div id="calendar1" class="calendar">
                <table>
                    <thead>
                        <tr id="calendar-header">
                            <th>時間</th>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- カレンダーの内容がここに追加される -->
                    </tbody>
                </table>
            </div>
            <div class="loading-spinner" id="loadingSpinner">
                <div class="spinner"></div>
                <div class="loading-text">読み込み中...</div>
            </div>
        </div>

        <div class="labeltyuuou">メッセージ<br>（質問等お気軽にご記入ください）</div>
        <textarea id="message" rows="4" placeholder="メッセージを入力してください"></textarea>

        <div class="labeltyuuou">ご予約内容</div>
        <div id="displayInfo"></div>

        <button class="submit-button" onclick="submitForm()">予約を行う</button>
    </div>

    <script src="https://static.line-scdn.net/liff/edge/2.1/sdk.js"></script>
    <script>
        // グローバル変数
        let visitCount = '';
        let selectedMenu = '';
        let selectedSymptom = [];
        let selectedFullDate = '';
        let currentDate = new Date();
        let availabilityCache = {};
        let irradiationsCount = '';
        let totalAmount = 0;
        let menuPrice = 0;
        let optionsPrice = 0;
        let selectedTreatment = null;
        let selectedPrice = 0;
        
        // DOM読み込み完了時の初期化
        document.addEventListener('DOMContentLoaded', function() {
            // LIFF初期化
            if (typeof liff !== 'undefined') {
                liff.init({
                    liffId: '${form.config.basic_info.liff_id}'
                }).then(() => {
                    console.log('LIFF初期化成功');
                }).catch((err) => {
                    console.log('LIFF初期化失敗', err);
                });
            }
            
            // カレンダー初期化
            initializeCalendar();
        });
        
        // 来店回数選択（単一選択、再クリックでキャンセル）
        function selectVisit(button) {
            // 既に選択されているボタンをクリックした場合はキャンセル
            if (button.classList.contains('active')) {
                button.classList.remove('active');
                visitCount = '';
                updateDisplayInfo();
                return;
            }
            
            // 他の来店回数ボタンの選択状態をクリア
            document.querySelectorAll('.visit-buttons button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // 新しい選択を設定
            button.classList.add('active');
            visitCount = button.textContent.trim();
            
            // 選択内容を更新表示
            updateDisplayInfo();
        }
        
        // 全体的なメニュー選択関数（シンプル構造とカテゴリー構造両対応）
        function selectSymptom(button, treatmentId) {
            // 既存の選択をクリア
            document.querySelectorAll('.symptoms button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // 新しい選択を設定
            button.classList.add('active');
            selectedTreatment = button.textContent.trim();
            selectedSymptom = [button.textContent.trim()];
            selectedMenu = button.textContent.trim();
            menuPrice = parseInt(button.getAttribute('data-price')) || 0;
            
            // メニュー選択時にカレンダーを表示
            showCalendar();
            
            // 選択内容を更新表示
            updateDisplayInfo();
        }
        
        // カレンダー表示関数
        function showCalendar() {
            // シンプル構造の場合
            const calendarWrapper = document.getElementById('calendar-wrapper');
            if (calendarWrapper) {
                calendarWrapper.style.display = 'block';
                setTimeout(() => {
                    calendarWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
                return;
            }
            
            // カテゴリー構造の場合
            const calendarContainer = document.querySelector('.calendar-container');
            if (calendarContainer) {
                calendarContainer.style.display = 'block';
                setTimeout(() => {
                    calendarContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        }
        
        // メニュー表示切り替え（カテゴリー構造用）
        function showMenu(menuId) {
            // 全てのメニューセクションを非表示
            document.querySelectorAll('.menu-section').forEach(section => {
                section.style.display = 'none';
            });
            
            // 全てのメニューカテゴリボタンの選択状態をリセット
            document.querySelectorAll('.menu-sections button').forEach(button => {
                button.classList.remove('active');
            });
            
            // 指定されたメニューセクションを表示
            const targetSection = document.getElementById(menuId);
            if (targetSection) {
                targetSection.style.display = 'block';
            }
            
            // 対応するボタンを選択状態にする
            if (event && event.target) {
                event.target.classList.add('active');
            }
        }
        
        function initializeCalendar() {
            // カレンダーの基本的な初期化（簡略版）
            console.log('カレンダー初期化');
        }
        
        // 日付選択処理
        function selectDate(element) {
            // 既存の選択をクリア
            document.querySelectorAll('.calendar-day.selected').forEach(el => {
                el.classList.remove('selected');
            });
            
            // 新しい日付を選択
            element.classList.add('selected');
            selectedFullDate = element.getAttribute('data-date');
            
            // 選択内容を更新表示
            updateDisplayInfo();
        }
        
        // 入力内容をローカルストレージに保存
        function saveInput(id) {
            const element = document.getElementById(id);
            if (element) {
                localStorage.setItem(id, element.value);
            }
        }
        
        // 予約内容表示更新
        function updateDisplayInfo() {
            const name = document.getElementById('name') ? document.getElementById('name').value : '';
            const phone = document.getElementById('phone') ? document.getElementById('phone').value : '';
            
            const labelStyle = "color:#0c0c0c; font-size:14px; border:1px solid #0c0c0c; padding:0px 3px; border-radius:4px;";
            
            const visitCountText = visitCount
                ? '<span style="' + labelStyle + '"><strong>来店回数</strong></span> ' + visitCount
                : '・来店回数が未選択です';
                
            const selectedMenuText = selectedMenu
                ? '<span style="' + labelStyle + '"><strong>コース</strong></span> ' + selectedMenu
                : '・コースが未選択です';
                
            const selectedSymptomText = selectedSymptom.length > 0
                ? '<span style="' + labelStyle + '"><strong>メニュー</strong></span><br>・' + selectedSymptom.join('<br>・')
                : '・メニューが未選択です';
                
            const totalAmountText = '<span style="' + labelStyle + '"><strong>合計金額</strong></span> ¥' + (menuPrice + optionsPrice);
            
            const selectedDateText = selectedFullDate
                ? '<span style="' + labelStyle + '"><strong>希望日時</strong></span> ' + selectedFullDate
                : '・日時が未選択です';
            
            const displayInfo = document.getElementById('displayInfo');
            if (displayInfo) {
                displayInfo.innerHTML = 
                    '<div class="info-row">' + visitCountText + '</div><hr>' +
                    '<div class="info-row">' + selectedMenuText + '</div><hr>' +
                    '<div class="info-row">' + selectedSymptomText + '</div><hr>' +
                    '<div class="info-row">' + totalAmountText + '</div><hr>' +
                    '<div class="info-row">' + selectedDateText + '</div>';
            }
        }
        
        function submitForm() {
            alert('これはプレビューです。実際の予約はできません。');
        }
        
        // プレビュー用のダミー関数
        function previousmonth() { console.log('前月'); }
        function nextmonth() { console.log('翌月'); }
        function previousWeek() { console.log('前週'); }
        function nextWeek() { console.log('翌週'); }
        function selectirradiations(button) { console.log('オプション選択:', button.textContent); }
    </script>
</body>
</html>`;
}
