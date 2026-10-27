# የንብረተ ቡዙነህ ትምህርት ቤት አስተዳደር ሲስተም

## 1. የፕሮጀክቱ ሁኔታ

ይህ ፕሮጀክት የHTML/CSS/JavaScript frontend እና Node.js/SQLite backend ይዟል። የተማሪ፣ የምዝገባ ማመልከቻ፣ የመገኘት፣ የክፍያ፣ የውጤት፣ የተጠቃሚና የግንኙነት መልዕክት መረጃዎች በSQLite ዳታቤዝ ውስጥ ይቀመጣሉ። የመስፈርት ሰነዱ ውስጥ ያሉ ሁሉም የሥራ ሞጁሎች ግን ገና አልተሟሉም፤ ስለዚህ ይህን እንደ ሙሉ የሥራ ላይ ሲስተም መጠቀም አይገባም።

`server.js` serves the frontend and connects the `/api` requests in `app.js` to SQLite. Authentication uses expiring `HttpOnly` cookie sessions, and passwords are stored as salted scrypt hashes.

> በ`localStorage` የሚቀመጠው `current_user` ለገጹ ላይ የተጠቃሚ መረጃ ለማሳየት ብቻ ነው። ይህ እውነተኛ መግቢያ ወይም የደህንነት ፍተሻ አይደለም። የተጠቃሚ ማንነትንና ፈቃድን ሰርቨሩ ማረጋገጥ አለበት።

## 2. ፕሮጀክቱን ማስኬድ

1. የNode.js 22.13 ወይም ከዚያ በላይ ስሪት ይጫኑ። ሌላ npm dependency መጫን አያስፈልግም።
2. To create the first admin, copy `.env.example` to `.env` and set `ADMIN_NAME`, `ADMIN_USERNAME`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD`. Alternatively, set the values in PowerShell:
   ```powershell
   $env:ADMIN_NAME = "School Administrator"
   $env:ADMIN_USERNAME = "schooladmin"
   $env:ADMIN_EMAIL = "admin@example.com"
   $env:ADMIN_PASSWORD = "your-unique-password-at-least-12-characters"
   ```
3. Run `npm run db:init` to create the database and tables, then `npm start` and open `http://localhost:3000`. The SQLite file is stored at `data/school.sqlite`; configure `DB_PATH` to use another location.
4. Run `npm test` to execute the API smoke and integration tests. `/api/health` checks the server and database connection.
5. Open `http://localhost:3000` for the simplest setup. To use VS Code Live Server instead, start the backend too and use a local address such as `http://127.0.0.1:5500`; local development pages automatically send API requests to port 3000. Do not open the page through `file://`.

There is no demo/default admin password. The first admin is created only when all `ADMIN_*` values are configured. A production school deployment still requires HTTPS, backups, controlled user provisioning, and operational policies.

### Reset a forgotten administrator password

1. Stop the running server.
2. In the project folder, run `npm run admin:reset-password` from an interactive terminal. The command uses `ADMIN_USERNAME` and `DB_PATH` from `.env` and asks for the new password twice without displaying it.
3. Use a new password between 12 and 128 characters, then restart the server with `npm start` and sign in at `http://localhost:3000/login.html`.

The command updates the existing `admin` account only. It does not display or change the password in `.env`, and it cannot create or change other account roles.

### Create teacher and registrar accounts

1. Sign in as an administrator and open `dashboard.html`.
2. Use the **Create Teacher or Registrar Account** form to select the role and enter the staff member's full name, a unique username, email, and a password of at least 8 characters.
3. Share the username and temporary password securely. Teachers sign in through `login.html` and are directed to `teacher-portal.html`; registrars are directed to `registration-review.html`.

The server allows this form to create only `teacher` and `registrar` accounts; users cannot create administrator accounts through it. Student accounts are created separately by approving an admission application in `registration-review.html`.

## 3. የፋይሎች መመሪያ

| ፋይል | ዓላማ | የአሁኑ ሁኔታ |
|---|---|---|
| `index.html` | የትምህርት ቤቱ መነሻ ገጽና ወደ ሌሎች ገጾች መግቢያ | Enquiry ቅጽ የbackend API በመጠቀም መልዕክት ያስቀምጣል። |
| `login.html` | የመግቢያ ቅጽና በrole መሠረት ወደ ገጽ ማዞር | `/api/auth/login` በኩል username/email እና password ያረጋግጣል። |
| `signup.html` | ተማሪ አካውንት እንዴት እንደሚያገኝ ማስረዳት | በቀጥታ አካውንት የሚፈጥር ቅጽ አይደለም፤ ተማሪው መጀመሪያ ማመልከቻ እንዲያስገባ ይመራል። |
| `online-registration.html` | የተማሪ የመግቢያ ማመልከቻና ሰነዶች መላክ | ማመልከቻውን በSQLite፣ ሰነዶችን ደግሞ በግል የserver ማከማቻ ያስቀምጣል፤ PDF/JPG/PNG፣ እስከ 5 ፋይሎች፣ እያንዳንዱ 4 MB ወይም ከዚያ ያነሰ። |
| `registration-review.html` | የተማሪ ማመልከቻዎችን፣ የተያያዙ ሰነዶችን ማየትና ውሳኔ መስጠት | በሬጅስትራር/Admin session የተጠበቀ ነው፤ ሰነгийн холбоосыг мөн серверийн эрхийн шалгалтаар хамгаална። |
| `registrationform.html` | የተማሪ መረጃ መመዝገብና ማስተዳደር | `/api/students` ይጠቀማል፤ የሰርተፊኬት ፋይል በዚህ ስሪት አይቀመጥም። |
| `dashboard.html` | የተማሪ፣ የሠራተኛ፣ የመገኘትና የውጤት ማጠቃለያ እና የአስተዳደር መዳረሻ | `/api/students`, `/api/users`, `/api/attendance`, `/api/fees`, `/api/results` ይፈልጋል። የአስተዳደር role-ዎች ይጠቀሙበታል። |
| `teacher-portal.html` | የተማሪ ውጤት መመዝገብና ማየት | `/api/students` እና `/api/results` በSQLite ዳታቤዝ ላይ ይሰራሉ። |
| `student-portal.html` | ተማሪው ከተፈቀደለት መለያ ገብቶ የራሱን መረጃ ማየት | በlogin ላይ `student` role ወደዚህ ፖርታል ይመራል፤ API የተማሪውን መገለጫ፣ ውጤት፣ መገኘትና ክፍያ በሰርቨር ያጣራል። |
| `attendance.html` | የተማሪ መገኘት መመዝገብና ማየት | መረጃው በSQLite ይቀመጣል። |
| `fees.html` | የክፍያ መዝገቦችን ማየት፣ መመዝገብና ማተም | የክፍያ መዝገብ ያስቀምጣል፤ ኦንላይን ክፍያ አያስኬድም። |
| `app.js` | API ጥያቄ፣ የተጠቃሚ መረጃ፣ role ማዞርና መውጣት | `/api` የሰርቨር መንገዶችን ይጠቀማል። |
| `server.js` | HTTP static server, `/api` routes, session authentication, input validation | Node.js built-in modules and SQLite. |
| `data/school.sqlite` | Persistent SQLite data store | Created on first run and excluded from git. |
| `data/registration-documents/` | Admission application documents | Private uploads addressed by random IDs and served only to authenticated registration staff. |
| `styles.css`, `home.css` | የጋራ እና የመነሻ ገጽ CSS | አንዳንድ ገጾች የራሳቸው CSS ስላላቸው አጠቃላይ ዲዛይኑ አንድ ዓይነት አይደለም። |

## 4. የተጠቃሚ ሚናና የገጽ መዳረሻ

| ሚና | የሚከፈተው ገጽ |
|---|---|
| `admin`, `super_admin`, `school_admin` | `dashboard.html` |
| `director`, `principal` | `dashboard.html` |
| `registrar` | `registration-review.html` |
| `teacher` | `teacher-portal.html` |
| `student` | `student-portal.html` |
| `parent` | የወላጅ ፖርታል ገጽ ገና የለም። |

የመስፈርት ሰነዱ የወላጅ ሚናን ያካትታል፤ ግን `parent-portal.html` በፕሮጀክቱ ውስጥ የለም። ወላጆችን ወደ ሌላ ሚና ገጽ በስህተት ከማዞር ይልቅ የወላጅ ፖርታልና የBackend የፈቃድ ሕጎቹ በተለይ መሠራት አለባቸው።

## 5. Frontend የሚጠብቃቸው API-ዎች

The following API routes are implemented in `server.js` and enforce session and role checks:

| ዘዴ | መንገድ | ዓላማ |
|---|---|---|
| `POST` | `/api/auth/login` | መግባት |
| `POST` | `/api/auth/signup` | አካውንት መፍጠር |
| `POST` | `/api/auth/logout` | የሰርቨር መግቢያን ማቋረጥ |
| `GET`, `POST` | `/api/users` | የተጠቃሚ ዝርዝር (GET) እና በadmin ብቻ teacher/registrar account መፍጠር (POST) |
| `GET`, `POST`, `PUT`, `DELETE` | `/api/students`, `/api/students/:id` | የተማሪ መረጃ ማስተዳደር |
| `POST`, `GET`, `PATCH` | `/api/registrations` እና `/api/registrations/:id` | ማመልከቻ መላክና መገምገም |
| `GET`, `POST` | `/api/attendance` | መገኘት ማየትና መመዝገብ |
| `GET`, `POST` | `/api/fees` | የክፍያ መዝገብ |
| `GET`, `POST` | `/api/results` | ውጤት ማየትና መመዝገብ |
| `POST` | `/api/enquiries` | Save the contact form enquiry to SQLite |
| `GET` | `/api/health` | Check server and database readiness |

Frontend role checks are only for navigation; the backend enforces authorization and isolates student data.

## 6. ከመስፈርት ሰነዱ ጋር የተደረገ ንጽጽር

| መስፈርት | የአሁኑ የfrontend ሁኔታ |
|---|---|
| መግቢያና በrole መሠረት ማዞር | የመግቢያ ገጽ አለ፤ እውነተኛ ማረጋገጫ API ይፈልጋል። |
| የተጠቃሚና role ማስተዳደር | የተጠቃሚ ዝርዝር API አለ፤ የተሟላ admin UI ግን አያስፈጽምም። |
| የይለፍ ቃል መቀየር/ማስመለስ | የገጽ ወይም የሥራ ሂደት አልታየም። |
| የተማሪ ማመልከቻና ግምገማ | የfrontend ገጾችና የBackend API አሉ። |
| የተማሪ መዝገብ ፍለጋ/ማሻሻያ | ቅጾችና API አጋዥ ኮድ በከፊል አሉ፤ ሙሉ ሥራው በሰርቨር መሞከር አለበት። |
| የመምህር ውጤት ማስገቢያ | የመምህር ገጽ አለ፤ ግን በአሁኑ ጊዜ አንድ አጠቃላይ ነጥብ ብቻ ያስገባል። የፈተና፣ የቤት ሥራና የመጨረሻ ፈተና ነጥቦች በተናጠል አይመዘገቡም። የነጥብ ድምርና የማለፊያ መለኪያዎችን ከትምህርት ቤቱ ሳይገለጽ መወሰን አይቻልም። |
| የውጤት ድምር/አማካይ | አንዳንድ የማሳያ ስሌቶች አሉ፤ የዳይሬክተር ማጽደቅና ሙሉ ሕጎች አልተረጋገጡም። |
| የተማሪ መገኘት | መመዝገብ/ማየት API አለ፤ በገጹ ላይ ከተለያዩ ሚናዎች ጋር መፈተሽ ይፈልጋል። |
| የዳይሬክተር ሪፖርት/ማጽደቅ/ማስታወቂያ/Activity Log | ሙሉ ሞጁሎች አልታዩም። |
| ክፍል፣ ትምህርትና የጊዜ ሰሌዳ | የማስተዳደሪያ ገጾች አልታዩም። |
| የወላጅ ፖርታል | የለም። |
| ዝውውርና ሰርተፊኬት | የሚመዘግቡና የሚያጸድቁ ገጾች አልታዩም። |
| PDF/Excel ሪፖርት | ሙሉ የሪፖርት ማውጫ እንዳለ አልተረጋገጠም። |
| አማርኛና እንግሊዝኛ | ገጾቹ በአብዛኛው እንግሊዝኛ ናቸው፤ የቋንቋ መቀየሪያ የለም። |
| ለሞባይል የሚስማማ አቀማመጥ | ብዙ ገጾች የስክሪን መጠን ለመቀየር CSS አላቸው፤ በተለያዩ መሣሪያዎች መሞከር ይጠይቃል። |
| ኦንላይን ክፍያ | በዚህ ስሪት ውስጥ አልተካተተም፤ `fees.html` የክፍያ መዝገብ ገጽ ነው። |
| Backup, HTTPS | በሥራ ላይ ከመዋሉ በፊት ማዋቀር ያስፈልጋል፤ የይለፍ ቃል hashing scrypt እና session `HttpOnly` cookie ይጠቀማሉ። |

## 7. በዚህ ማሻሻያ የተደረጉ ለውጦች

- `app.js`፦ የrole ስሞችን ከትልቅ/ትንሽ ፊደል፣ ክፍተትና ዳሽ ልዩነት አስወግዶ አንድ ዓይነት ያደርጋል። `director`/`principal` እና የአድሚን ስሞች ወደ እውነት ወዳሉ ገጾች ይሄዳሉ። የሌሉ የወላጅ፣ HR እና accountant ገጾች ወደሚመሩ የተሳሳቱ አድራሻዎች ተወግደዋል።
- `login.html`፦ `director` role ወደ dashboard ይመራል።
- `dashboard.html`፦ የአድሚንና የዳይሬክተር ሚናዎችን ይቀበላል። ተጠቃሚው ካልተረጋገጠ dashboard ዳታ ማስጫን ያቆማል። የሌለው `results.html` አገናኝ ወደ ነባሩ የመምህር ውጤት ገጽ ተቀይሯል። የመውጫ ቁልፉ `app.js` ውስጥ ያለውን የመውጫ ተግባር ይጠራል።
- `index.html`፦ በመነሻ ገጹ ያለው የሎጎ አገናኝ በስህተት `indx.html` ይጠቁም ነበር። ወደ `index.html` ተስተካክሏል።
- `teacher-portal.html`፦ በውጤት መመዝገቢያው JavaScript ውስጥ የስክሪፕቱን ስህተት የሚያመጣው ጽሑፍ ተስተካክሏል።
- `teacher-portal.html`፦ የHTML ፋይሉ መጨረሻ ላይ የተረፈው የMarkdown ኮድ ምልክት ተወግዷል።

The website also now has a SQLite-backed API. The frontend's local role checks are for navigation only; server-side sessions and role checks protect API data.

## 8. ቀጣይ የልማት ደረጃዎች

1. የወላጅ ፖርታልና በተያያዙ ተማሪዎች ላይ የሚሰሩ የBackend ፈቃዶችን መጨመር።
2. የይለፍ ቃል መመለስ፣ ክፍል/ትምህርት፣ የጊዜ ሰሌዳ፣ ዝውውር፣ ሰርተፊኬት፣ ማስታወቂያ፣ ሪፖርትና የእንቅስቃሴ መዝገብ ሞጁሎችን ማሟላት።
3. የምርት ላይ ማስተናገድ ሲደረግ HTTPS, SQLite backup, secret management, monitoring болон rate limiting тохируулах.
4. ቅጾቹን ከAPI ጋር ማስማማት፣ በተለያዩ ሚናዎችና ብራውዘሮች ላይ መፈተሽ።
