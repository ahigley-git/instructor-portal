// Sheet structure and the starting data for the ResQ Instructor Portal.
// Used by the tests, the local preview and the one-time sheet setup.

export const TABS = {
  ins: 'Instructors', certs: 'Certs', roles: 'Roles', courses: 'Courses',
  sessions: 'Sessions', slots: 'Slots', reqs: 'Requests', settings: 'Settings'
};

export const HEADERS = {
  Instructors: ['Name', 'Email', 'Phone', 'Credentials', 'Status', 'Qualified roles', 'Cert folder', 'Applied', 'Decided', 'Decided by', 'About', 'Admin notes'],
  Certs: ['Uploaded', 'Email', 'Credential', 'Expires', 'File name', 'Link', 'File ID'],
  Roles: ['Role', 'Code', 'Description', 'Requirements', 'Open to all approved', 'Active', 'Order'],
  Courses: ['Course ID', 'Course', 'Start', 'End', 'Location', 'Status', 'Students', 'Description'],
  Sessions: ['Session ID', 'Course ID', 'Day', 'Date', 'Block', 'Start', 'End', 'Topic', 'Status'],
  Slots: ['Slot ID', 'Session ID', 'Role', 'Openings', 'Pay ($)', 'Call', 'Release', 'Notes', 'Status'],
  Requests: ['Request ID', 'Slot ID', 'Email', 'Name', 'Status', 'Requested', 'Updated', 'Decided by', 'Amount ($)', 'Paid on', 'Reminder sent', 'Note'],
  Settings: ['Setting', 'Value', 'What it does']
};

export const ROLES = [
  ['Primary Instructor', 'PRI', 'Leads the block: teaches every lecture and runs the day.', 'EMT instructor approved by ResQ (Paramedic or EMT with instructor experience).', 'No', 'Yes', 1],
  ['Assistant Instructor', 'AST', 'Runs skills stations and coaches scenarios. Counted 1 per 3 students.', 'At least EMT certified (current MN or NREMT).', 'No', 'Yes', 2],
  ['Patient', 'PAT', 'Plays the patient in scenarios, the MCI or the psychomotor exam.', 'No certification needed. Wear clothes that can get dirty.', 'Yes', 'Yes', 3],
  ['Skills Evaluator', 'EVAL', 'Evaluates NREMT psychomotor skill stations.', 'EMT or higher, meeting MN OEMS psychomotor evaluator requirements.', 'No', 'Yes', 4],
  ['Guest Lecturer', 'GL', 'Teaches one topic or block.', 'Approved by ResQ for the topic.', 'No', 'Yes', 5],
  ['Station Medic', 'MED', 'Runs one Day 10 variance station (anaphylaxis, stroke, IV, intubation, EKG, meds). Counts toward the assistant ratio.', 'Paramedic, or paid ResQ staff approved for the station.', 'No', 'Yes', 6],
  ['AHA BLS Instructor', 'BLS', 'Runs the AHA BLS course and skills tests on Day 1 (AHA ratio 1:6) and works as an assistant for the rest of the block.', 'Current AHA BLS Instructor card, aligned with ResQ\'s Training Center.', 'No', 'Yes', 7]
];

export const SETTINGS = [
  ['Email admins: new instructor signup', 'On', 'Admins get an email when someone signs up.'],
  ['Email admins: new slot request', 'On', 'Admins get an email when someone requests or waitlists for a slot.'],
  ['Email admins: drop request', 'On', 'Admins get an email when someone asks to drop an approved slot.'],
  ['Email instructor: account approved or declined', 'On', 'Instructor gets an email when their account status changes.'],
  ['Email instructor: slot status change', 'On', 'Instructor gets an email when a slot is approved, declined, waitlisted, moved up from the waitlist, or dropped.'],
  ['Email instructor: session reminder', 'On', 'Instructor gets a reminder before each approved slot.'],
  ['Email instructor: marked paid', 'On', 'Instructor gets an email when a slot is marked paid.'],
  ['Reminder days before session', 3, 'How many days before the session the reminder goes out.'],
  ['Admin alert emails', '', 'Who gets admin alerts. Leave blank to use the admin list in Netlify.']
];

// ---- January and June 2027 Accelerated EMT, staffed for 9 students (3:1) ----
const JAN = ['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15', '2027-01-16', '2027-01-18', '2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22', '2027-01-23'];
const JUN = ['2027-05-31', '2027-06-01', '2027-06-02', '2027-06-03', '2027-06-04', '2027-06-05', '2027-06-07', '2027-06-08', '2027-06-09', '2027-06-10', '2027-06-11', '2027-06-12'];

// Per day: AM/PM topics and the slots each block needs beyond the Primary Instructor.
// [role code, openings, call, release, notes]
const PLAN = [
  { am: 'BLS, EMS foundations, vital signs', pm: 'AHA BLS course, BLS written exam, CAM NREMT intro',
    pmSlots: [['BLS', 2, '1300', '1725', 'Run the AHA BLS course and skills tests 1300–1605 (AHA 1:6), then assist at vital signs stations.'],
      ['AST', 1, '1300', '1725', 'Assistants arrive for BLS part 1 and set up vital signs stations.']] },
  { am: 'Transport, medical terminology, assessment foundations, life span', pm: 'Lifting and moving rotations, NREMT/OEMS registration',
    pmSlots: [['AST', 3, '1315', '1630', 'Lifting and moving: stretcher, backboards, stair chair, MegaMover stations.']] },
  { am: 'Medical assessment, respiratory, airway, O2/BVM demos', pm: 'Pharmacology, airway and lung-sound breakouts, assessment practice',
    pmSlots: [['AST', 3, '1415', '1725', 'Breakouts: lung sounds and assessment walkthrough; airway skills including BVM seal.']] },
  { am: 'Shock, cardiovascular, neurological', pm: 'Allergic reactions, skills rotations, practice assessments',
    pmSlots: [['AST', 3, '1345', '1725', 'Skills rotations: patient assessment scenarios (STEMI), airway, med bag, CAM/stroke scale.'],
      ['PAT', 3, '1345', '1725', 'Patient for assessment scenarios (STEMI chest pain).']] },
  { am: 'GI/GU, renal, hematology, endocrine', pm: 'Toxicology, psychiatric, medical scenarios',
    pmSlots: [['AST', 3, '1450', '1725', 'Medical scenarios in groups of 3; every student leads.'],
      ['PAT', 3, '1450', '1725', 'Patient for medical scenarios (hypoglycemia, opioid overdose).']] },
  { am: 'Sepsis, environmental, AMS, OB/GYN, neonatal', pm: 'OB rotations, scenarios and IO variance',
    pmSlots: [['AST', 3, '1300', '1715', 'OB rotations, then septic shock, neonatal and IO/i-gel stations.'],
      ['PAT', 3, '1300', '1715', 'Patient for OB, placenta/baby problem and septic shock scenarios.']] },
  { am: 'Trauma overview, bleeding, burns, orthopedics', pm: 'Head and spine, bleeding rotations, splinting, trauma scenarios',
    pmSlots: [['AST', 3, '1400', '1725', 'Wound packing, bleeding control, splinting and spinal care scenarios.'],
      ['PAT', 3, '1400', '1725', 'Trauma patient (multi-system trauma with major bleeding). Moulage likely.']] },
  { am: 'Face/neck, chest, abdominal trauma, pediatrics, geriatrics', pm: 'Special challenges, rotations, auto extrication',
    pmSlots: [['AST', 3, '1340', '1640', 'Rotations, then auto extrication outside. Dress for the weather.'],
      ['PAT', 3, '1340', '1525', 'Patient for the pediatric respiratory distress scenario and trauma talk-through.']] },
  { am: 'WMD, MCI scenario', pm: 'Full-call simulation, NREMT skill stations',
    amSlots: [['AST', 3, '0900', '1200', 'MCI triage exercise. Best booked together with the afternoon.'],
      ['PAT', 9, '0900', '1200', 'MCI role player (volunteer). Moulage and acting.']],
    pmSlots: [['AST', 3, '1300', '1725', 'Full-call simulation, then NREMT skill sheet stations. Unpaid lunch.'],
      ['PAT', 3, '1300', '1500', 'Patient for the full-call simulation (cardiac arrest).']] },
  { am: 'Variance stations, exam briefing', pm: 'NREMT skill stations, exam Q&A',
    amSlots: [['MED', 6, '0800', '1140', 'Run one variance station: anaphylaxis, stroke, IV assistance, intubation, basic EKG, or med draw-up/IM.'],
      ['PAT', 2, '0800', '1140', 'Patient for the anaphylaxis and stroke variance scenarios.']],
    pmSlots: [['AST', 3, '1300', '1630', 'NREMT skill sheet stations; confirm every student\'s 10 sim contacts are logged.']] },
  { am: 'Mock NREMT', pm: 'NREMT psychomotor exam',
    amSlots: [['AST', 3, '0800', '1200', 'Mock NREMT run-through of every skill station.']],
    pmSlots: [['AST', 3, '1300', '1725', 'Support the psychomotor exam. Unpaid lunch.'],
      ['EVAL', 6, '1300', '1725', 'NREMT psychomotor exam evaluator.'],
      ['PAT', 2, '1300', '1725', 'Psychomotor exam patient.']] },
  { am: 'Final review, course final, graduation', pm: null }
];

const mdY = (iso) => { const [y, m, d] = iso.split('-').map(Number); return m + '/' + d + '/' + y; };

export function buildSchedule() {
  const courses = [], sessions = [], slots = [];
  const cohorts = [
    ['EMT-2027-01', 'Accelerated EMT — January 2027', JAN],
    ['EMT-2027-06', 'Accelerated EMT — June 2027', JUN]
  ];
  for (const [cid, cname, dates] of cohorts) {
    courses.push([cid, cname, mdY(dates[0]), mdY(dates[11]), 'Cottage Grove', 'Open', 9,
      '12 in-person days (Days 1–11 0730–1730, Day 12 0800–1200). Staffed for 9 students: 1 assistant and 1 patient per 3 students on hands-on blocks.']);
    PLAN.forEach((p, i) => {
      const day = i + 1, date = mdY(dates[i]);
      const blocks = [['AM', day === 12 ? '0800' : '0730', '1200', p.am, p.amSlots || []]];
      if (p.pm) blocks.push(['PM', '1300', '1730', p.pm, p.pmSlots || []]);
      for (const [blk, start, end, topic, extra] of blocks) {
        const sid = cid + '-D' + String(day).padStart(2, '0') + '-' + blk;
        sessions.push([sid, cid, day, date, blk, start, end, topic, 'Open']);
        slots.push([sid + '-PRI', sid, 'Primary Instructor', 1, 0, start, end, day === 12 ? 'Final review, proctor the course final, graduation.' : blk === 'AM' ? 'Morning lectures and skills.' : 'Afternoon block.', 'Open']);
        for (const [code, n, call, rel, notes] of extra) {
          const role = ROLES.find((r) => r[1] === code)[0];
          slots.push([sid + '-' + code, sid, role, n, 0, call, rel, notes, 'Open']);
        }
      }
    });
  }
  return { courses, sessions, slots };
}

// A full workbook as arrays of rows (header first).
export function seedTabs() {
  const { courses, sessions, slots } = buildSchedule();
  return {
    Instructors: [HEADERS.Instructors],
    Certs: [HEADERS.Certs],
    Roles: [HEADERS.Roles, ...ROLES],
    Courses: [HEADERS.Courses, ...courses],
    Sessions: [HEADERS.Sessions, ...sessions],
    Slots: [HEADERS.Slots, ...slots],
    Requests: [HEADERS.Requests],
    Settings: [HEADERS.Settings, ...SETTINGS]
  };
}
