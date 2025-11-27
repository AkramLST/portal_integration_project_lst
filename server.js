const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const os = require("os");
const { MongoClient } = require("mongodb");
const authMiddleware = require("./authMiddleware");

const app = express();
app.use(cors());
app.use(express.json()); // parse application/json
app.use(express.urlencoded({ extended: true })); // parse application/x-www-form-urlencoded
// =======================================
// 🧩 MongoDB setup
// =======================================
const mongoUri =process.env.DATABASE;
const client = new MongoClient(mongoUri);
const dbName = "StemClub";
const user = { name: "akrambhatti", password: "12345" };
// =======================================
// 🧩 Field widths for .dat formatting
// =======================================
const ACTIVITY_TYPES = [
  { key: "steamclub", label: "STEM Club" },
  { key: "starsteamclub", label: "STAR-STEAM Club" },
  { key: "steamsafeerclub", label: "STEM Safeer" },
  { key: "starsteamsafeer", label: "STAR-STEAM Safeer" },
  { key: "teacherhub", label: "Teacher Hub" },
  { key: "starteacherhub", label: "STAR-Teachers Hub" },
  { key: "storysession", label: "Storytelling Session" },
  { key: "starstorysession", label: "STAR-STEAM storytelling" },
  { key: "steamclubdemo", label: "STEAM Clubs Demonstration" },
  { key: "starsteamclubdemo", label: "STAR-STEAM Club Demonstration" },

  { key: "wholeschool", label: "Whole School STEAM Activity" },
  { key: "onedaycomp", label: "1-Day STEAM Competition" },

  // You can easily add more later
];

// 2️⃣ Dynamically build the projection fields
const activityProjections = ACTIVITY_TYPES.reduce((acc, { key, label }) => {
  acc[`${key}Acts`] = {
    $size: {
      $filter: {
        input: "$activities",
        as: "act",
        cond: { $eq: ["$$act.activityType", label] },
      },
    },
  };

  acc[`${key}Participants`] = {
    $sum: {
      $map: {
        input: {
          $filter: {
            input: "$activities",
            as: "act",
            cond: { $eq: ["$$act.activityType", label] },
          },
        },
        as: "act",
        in: "$$act.participants",
      },
    },
  };

  acc[`${key}MaleParticipants`] = {
    $sum: {
      $map: {
        input: {
          $filter: {
            input: "$activities",
            as: "act",
            cond: { $eq: ["$$act.activityType", label] },
          },
        },
        as: "act",
        in: "$$act.males",
      },
    },
  };

  acc[`${key}FemaleParticipants`] = {
    $sum: {
      $map: {
        input: {
          $filter: {
            input: "$activities",
            as: "act",
            cond: { $eq: ["$$act.activityType", label] },
          },
        },
        as: "act",
        in: "$$act.females",
      },
    },
  };

  return acc;
}, {});
////////Fields
function calculateLevelAfterSept(doc) {
  const regDate = new Date(doc.createdAt);
  const cutoffDate = new Date("2025-09-30T00:00:00.000Z");

  // Normalize special cases like 111–115 → 11–15
  let currentLevel = Number(doc.schoollevel ?? 0);
  if (currentLevel >= 111 && currentLevel <= 115) {
    currentLevel = Number(currentLevel.toString().replace(/^11/, "1"));
  }

  // Normalize previous level too (just in case it was encoded like 111)
  let levelBeforeSept = Number(doc.levelBeforeSept ?? 0);
  if (levelBeforeSept >= 111 && levelBeforeSept <= 115) {
    levelBeforeSept = Number(levelBeforeSept.toString().replace(/^11/, "1"));
  }

  // Adjustment rule for schools with level = 1
  if (currentLevel === 1) {
    const regDateStr = regDate.toISOString().slice(0, 10);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    if (regDateStr <= cutoffStr) {
      // Registered on or before 30 Sept → had level 1 already
      levelBeforeSept = 1;
    } else {
      // Registered after 30 Sept → achieved after cutoff
      levelBeforeSept = 0;
    }
  }

  // Calculate change (level after Sept)
  const levelAfterSept =
    currentLevel && levelBeforeSept >= 0 ? currentLevel - levelBeforeSept : 0;

  return levelAfterSept;
}

const FIELD_WIDTHS = {
  province: 40,
  district: 40,
  emiscode: 40,
  schoolname: 100,
  typeOfSchool: 50,
  tierOfSchool: 50,
  consent: 20,
  schoollevel: 10,
  levelafterSep: 10,
  cycle: 10,
  username: 60,
  phone: 15,
  email: 80,

  designation: 20,
  submission_date_student_registration: 20,
  students_registered_steamculb_registration: 10,
  male_students_registered_steamculb_registration: 10,
  female_students_registered_steamculb_registration: 10,
  teachers_participated_baseline_perception: 10,
  teachers_participated_endline_perception: 10,
  student_hands_on_activities: 10,
  steam_safeer_clubActs: 10,
  teacher_hub_Acts: 10,
  story_session_Acts: 10,
  steam_club_demo_Acts: 10,
  whole_school_Acts: 10,
  oneday_steam_compActs: 10,
  star_steam_total_Acts: 10,
  total_acts_submitted: 10,
  total_acts_accepted: 10,
  total_acts_rejected: 10,
  total_acts_under_review: 10,

  total_Students_In_Steam_Club_Acts: 10,
  total_Male_Students_In_Steam_Club_Acts: 10,
  total_Female_Students_In_Steam_Club_Acts: 10,
  total_Teachers_In_Steam_Club_Acts: 10,
  total_Male_Teachers_In_Steam_Club_Acts: 10,
  total_Female_Teachers_In_Steam_Club_Acts: 10,
  schoolwithmorethanfiveacts: 10,
};

// =======================================
// 🧩 Utility: Format text to fixed width
// =======================================
function formatField(value, width, align = "left", padChar = " ") {
  const text = value == null ? "" : String(value).trim();
  if (text.length >= width) return text.slice(0, width);
  return align === "right"
    ? text.padStart(width, padChar)
    : text.padEnd(width, padChar);
}
// =======================================
// 🧩 Create .csv file
// =======================================
// =======================================
// 🧩 Create .csv file (with readable dates)
// =======================================
function createCsvFile(folder, records) {
  const csvPath = path.join(folder, "SchoolData.csv");

  // Helper: format date like "17-Sep-2025"
  function formatDate(date) {
    if (!date) return "";
    const d = new Date(date);
    if (isNaN(d)) return "";
    const day = d.getDate().toString().padStart(2, "0");
    const month = d.toLocaleString("en-US", { month: "short" });
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

  const headers = [
    "Province",
    "District",
    "EMIS Code",
    "School Name",
    "Type of School",
    "Tier of School",

    "Consent Form",
    "STEAM Journey Level of School",
    "Change in Level of School after 30th september",
    "STEAM Journey Cycle of School",

    "Focal Person",
    "Phone",
    "Email",

    "Designation",
    "Submission Date of STEAM Club Student Registration",
    "Number of Students Registered in STEAM Clubs",
    "Number of Male Students Registered in STEAM Clubs",
    "Number of Female Students Registered in STEAM Clubs",

    "Number of Teachers who Participated in Baseline Perception",
    "Number of Teachers who Participated in Baseline Perception",

    // "Level After Sep",

    "STEAM Club Activities",
    // "STEAM Club Participants",
    // "STEAM Club Male",
    // "STEAM Club Female",
    "STEAM Safeer Activities",
    // "STEAM Safeer Participants",
    // "STEAM Safeer Male",
    // "STEAM Safeer Female",
    "Teacher Hub Activities",
    // "Teacher Hub Participants",
    // "Teacher Hub Male",
    // "Teacher Hub Female",
    "Story telling Activities",
    // "Story telling Participants",
    // "Story telling Male",
    // "Story telling Female",
    "Steam Demo Activities",
    // "Steam Demo Participants",
    // "Steam Demo Male",
    // "Steam Demo Female",
    "Whole school Activities",
    // "Whole School Participants",
    // "Whole School Male",
    // "Whole School Female",
    "One Day STEAM Competition",
    "STAR STEAM Club activities",
    "Total Number of Activities submitted by ILMPact School",
    "Total Number of Activities Approved",
    "Total Number of Activities not Approved",
    "Total Number of Activities under Review",
    ////
    // "Total STEAM Slub Acts",
    "Total Number of students engaged in the STEAM Club Activities",
    "Total Number of male students engaged",
    "Total Number of female students engaged",

    "Total Number of teachers engaged in the STEAM Club Activities",
    "Total Number of male teachers engaged",
    "Total Female Teachers in Steam Club Acts",
    "Schools that completed 5 approved activities",

    ///
  ];

  const rows = records.map((doc) => {
    const levelAfterSept = calculateLevelAfterSept(doc);

    const reg = doc.registration[0] || {};
    const perc = doc.perception[0] || {};
    const end = doc.endPerception[0] || {};

    return [
      `"${doc.province || ""}"`,
      `"${doc.district || ""}"`,
      `"${doc.emiscode || ""}"`,
      `"${doc.schoolName || ""}"`,
      `"${doc.typeOfSchool || ""}"`,
      `"${doc.tierOfSchool || ""}"`,
      `"${doc.status || ""}"`,
      `"${doc.schoollevel || ""}"`,
      `"${calculateLevelAfterSept(doc)}"`,
      `"${doc.cycle || ""}"`,

      `"${doc.name || ""}"`,
      `"${doc.phone || ""}"`,
      `"${doc.email || ""}"`,
      `"${doc.role || ""}"`,
      formatDate(reg.createdAt),

      reg.numberOfParticipants || 0,
      reg.maleParticipants || 0,
      reg.femaleParticipants || 0,
      perc.formDataCount || 0,
      end.formDataCount || 0,

      // `"${doc.schoolLevelAfterSept || ""}"`,

      doc.steamclubActs || 0,
      // doc.steamclubParticipants || 0,
      // doc.steamclubMaleParticipants || 0,
      // doc.steamclubFemaleParticipants || 0,
      doc.steamsafeerclubActs || 0,
      // doc.steamsafeerclubParticipants || 0,
      // doc.steamsafeerclubMaleParticipants || 0,
      // doc.steamsafeerclubFemaleParticipants || 0,
      // //////
      doc.teacherhubActs || 0,
      // doc.teacherhubParticipants || 0,
      // doc.teacherhubMaleParticipants || 0,
      // doc.teacherhubFemaleParticipants || 0,
      doc.storysessionActs || 0,
      // doc.storysessionParticipants || 0,
      // doc.storysessionMaleParticipants || 0,
      // doc.storysessionFemaleParticipants || 0,
      doc.steamclubdemoActs || 0,
      // doc.steamclubdemoParticipants || 0,
      // doc.steamclubdemoMaleParticipants || 0,
      // doc.steamclubdemoFemaleParticipants || 0,
      doc.wholeschoolActs || 0,
      // doc.wholeschoolParticipants || 0,
      // doc.wholeschoolMaleParticipants || 0,
      // doc.wholeschoolFemaleParticipants || 0,
      doc.onedaycompActs || 0,
      (doc.starsteamclubActs || 0) +
        (doc.starsteamsafeerActs || 0) +
        (doc.starteacherhubActs || 0) +
        (doc.starstorysessionActs || 0) +
        (doc.starsteamclubdemoActs || 0),
      doc.totalActivities || 0,
      doc.totalAccepted || 0,
      doc.totalRejected || 0,
      doc.totalPending || 0,
      // (doc.steamclubActs || 0) +
      //   (doc.starsteamclubActs || 0) +
      //   (doc.storysessionActs || 0) +
      //   (doc.starstorysessionActs || 0) +
      //   (doc.steamsafeerclubActs || 0) +
      //   (doc.starsteamsafeerActs || 0) +
      //   (doc.steamclubdemoActs || 0) +
      //   (doc.starsteamclubdemoActs || 0),
      (doc.steamclubParticipants || 0) +
        (doc.starsteamclubParticipants || 0) +
        (doc.storysessionParticipants || 0) +
        (doc.starstorysessionParticipants || 0) +
        (doc.steamsafeerclubParticipants || 0) +
        (doc.starsteamsafeerParticipants || 0) +
        (doc.steamclubdemoParticipants || 0) +
        (doc.starsteamclubdemoParticipants || 0),
      (doc.steamclubMaleParticipants || 0) +
        (doc.starsteamclubMaleParticipants || 0) +
        (doc.storysessionMaleParticipants || 0) +
        (doc.starstorysessionMaleParticipants || 0) +
        (doc.steamsafeerclubMaleParticipants || 0) +
        (doc.starsteamsafeerMaleParticipants || 0) +
        (doc.steamclubdemoMaleParticipants || 0) +
        (doc.starsteamclubdemoMaleParticipants || 0),
      (doc.steamclubFemaleParticipants || 0) +
        (doc.starsteamclubFemaleParticipants || 0) +
        (doc.storysessionFemaleParticipants || 0) +
        (doc.starstorysessionFemaleParticipants || 0) +
        (doc.steamsafeerclubFemaleParticipants || 0) +
        (doc.starsteamsafeerFemaleParticipants || 0) +
        (doc.steamclubdemoFemaleParticipants || 0) +
        (doc.starsteamclubdemoFemaleParticipants || 0),
      ///
      (doc.teacherhubParticipants || 0) + (doc.starteacherhubParticipants || 0),

      (doc.teacherhubMaleParticipants || 0) +
        (doc.starteacherhubMaleParticipants || 0),

      (doc.teacherhubFemaleParticipants || 0) +
        (doc.starteacherhubFemaleParticipants || 0),
      ///
      doc.totalAccepted >= 5 ? "Yes" : "No",
    ].join(",");
  });

  const csvContent = [headers.join(","), ...rows].join("\n");
  fs.writeFileSync(csvPath, csvContent, "utf-8");
  console.log(`✅ .csv file created at: ${csvPath}`);
  return csvPath;
}

// function for level display

function levelLabel (level){
  switch(level)
  {
     case 111:
        return "11+";
      case 112:
        return "12+";
      case 113:
        return "13+";
      case 114:
        return "14+";
      case 115:
        return "15+";
      default:
        return level;
  }
}

// =======================================
// 🧩 Create .dat file
// =======================================
function createDatFile(records) {
  const lines = records.map((doc, idx) => {
    const reg = doc.registration?.[0] || {};
    const perc = doc.perception?.[0] || {};
    const end = doc.endPerception?.[0] || {};
    doc.schoollevel = levelLabel(doc.schoollevel);

    return (
      "1" +
      formatField(idx + 1, 6, "right") +
      formatField(doc.province ?? "", FIELD_WIDTHS.province, "left", " ") +
      formatField(doc.district ?? "", FIELD_WIDTHS.district, "left", " ") +
      formatField(doc.emiscode, FIELD_WIDTHS.emiscode, "right", " ") +
      formatField(doc.schoolName, FIELD_WIDTHS.schoolname) +
      formatField(
        doc.typeOfSchool ?? "",
        FIELD_WIDTHS.typeOfSchool,
        "left",
        " "
      ) +
      formatField(
        doc.tierOfSchool ?? "",
        FIELD_WIDTHS.tierOfSchool,
        "left",
        " "
      ) +
      formatField(doc.status ?? "", FIELD_WIDTHS.consent, "left", " ") +
      formatField(
        doc.schoollevel ?? "",
        FIELD_WIDTHS.schoollevel,
        "right",
        " "
      ) +
      formatField(
        calculateLevelAfterSept(doc),
        FIELD_WIDTHS.levelafterSep,
        "right",
        " "
      ) +
      formatField(doc.cycle ?? "", FIELD_WIDTHS.cycle, "right", " ") +
      formatField(doc.name, FIELD_WIDTHS.username) +
      // formatField(
      //   (doc.phone || "").replace(/\D/g, ""),
      //   FIELD_WIDTHS.phone,
      //   "right",
      //   " "
      // ) +
      // formatField(doc.email, FIELD_WIDTHS.email) +
      formatField(doc.role ?? "", FIELD_WIDTHS.designation, "left", " ") +
      formatField(
        reg.createdAt
          ? new Date(reg.createdAt).toISOString().split("T")[0]
          : "",
        FIELD_WIDTHS.submission_date_student_registration
      ) +
      formatField(
        reg.numberOfParticipants,
        FIELD_WIDTHS.students_registered_steamculb_registration,
        "right"
      ) +
      formatField(
        reg.maleParticipants,
        FIELD_WIDTHS.male_students_registered_steamculb_registration,
        "right"
      ) +
      formatField(
        reg.femaleParticipants,
        FIELD_WIDTHS.female_students_registered_steamculb_registration,
        "right"
      ) +
      formatField(
        doc.totalAccepted >= 5 ? "Yes" : "No",
        FIELD_WIDTHS.schoolwithmorethanfiveacts,
        "left",
        " "
      )
    );
  });

  const content = lines.join("\n");
  return content;
}
function formatField2(value, width, alignment = "right") {
  const str = String(value ?? "");
  if (alignment === "right") {
    // For numeric fields, use zero-padding
    return str.padStart(width, "0");
  } else {
    // For text fields, space padding is fine
    return str.padEnd(width, " ");
  }
}

function createDatSummary(records) {
  const totals = {
    teachersBaselinePerception: 0,
    teachersEndlinePerception: 0,
    steamclubActs: 0,
    steamsafeerclubActs: 0,
    teacherhubActs: 0,
    storysessionActs: 0,
    steamclubdemoActs: 0,
    wholeschoolActs: 0,
    onedaycompActs: 0,
    starsteamtotalActs: 0,
    totalActivities: 0,
    totalAccepted: 0,
    totalRejected: 0,
    totalPending: 0,
    totalStudents: 0,
    totalMaleStudents: 0,
    totalFemaleStudents: 0,
    totalTeachers: 0,
    totalMaleTeachers: 0,
    totalFemaleTeachers: 0,
  };

  // Sum all records
  for (const doc of records) {
    totals.teachersBaselinePerception +=
      doc.perception?.[0]?.formDataCount ?? 0;
    totals.teachersEndlinePerception +=
      doc.endPerception?.[0]?.formDataCount ?? 0;

    totals.steamclubActs += doc.steamclubActs ?? 0;
    totals.steamsafeerclubActs += doc.steamsafeerclubActs ?? 0;
    totals.teacherhubActs += doc.teacherhubActs ?? 0;
    totals.storysessionActs += doc.storysessionActs ?? 0;
    totals.steamclubdemoActs += doc.steamclubdemoActs ?? 0;
    totals.wholeschoolActs += doc.wholeschoolActs ?? 0;
    totals.onedaycompActs += doc.onedaycompActs ?? 0;

    totals.starsteamtotalActs +=
      (doc.starsteamclubActs ?? 0) +
      (doc.starsteamsafeerActs ?? 0) +
      (doc.starteacherhubActs ?? 0) +
      (doc.starsteamclubdemoActs ?? 0) +
      (doc.starstorysessionActs ?? 0);

    totals.totalActivities += doc.totalActivities ?? 0;
    totals.totalAccepted += doc.totalAccepted ?? 0;
    totals.totalRejected += doc.totalRejected ?? 0;
    totals.totalPending += doc.totalPending ?? 0;

    totals.totalStudents +=
      Number(doc.steamclubParticipants ?? 0) +
      Number(doc.starsteamclubParticipants ?? 0) +
      Number(doc.storysessionParticipants ?? 0) +
      Number(doc.starstorysessionParticipants ?? 0) +
      Number(doc.steamsafeerclubParticipants ?? 0) +
      Number(doc.starsteamsafeerParticipants ?? 0) +
      Number(doc.steamclubdemoParticipants ?? 0) +
      Number(doc.starsteamclubdemoParticipants ?? 0) +
      Number(doc.wholeschoolParticipants ?? 0) +
      Number(doc.onedaycompParticipants ?? 0);

    totals.totalMaleStudents +=
      (doc.steamclubMaleParticipants ?? 0) +
      (doc.starsteamclubMaleParticipants ?? 0) +
      (doc.storysessionMaleParticipants ?? 0) +
      (doc.starstorysessionMaleParticipants ?? 0) +
      (doc.steamsafeerclubMaleParticipants ?? 0) +
      (doc.starsteamsafeerMaleParticipants ?? 0) +
      (doc.steamclubdemoMaleParticipants ?? 0) +
      (doc.starsteamclubDemoMaleParticipants ?? 0) +
      (doc.wholeschoolMaleParticipants ?? 0) +
      (doc.onedaycompMaleParticipants ?? 0);

    totals.totalFemaleStudents +=
      (doc.steamclubFemaleParticipants ?? 0) +
      (doc.starsteamclubFemaleParticipants ?? 0) +
      (doc.storysessionFemaleParticipants ?? 0) +
      (doc.starstorysessionFemaleParticipants ?? 0) +
      (doc.steamsafeerclubFemaleParticipants ?? 0) +
      (doc.starsteamsafeerFemaleParticipants ?? 0) +
      (doc.steamclubdemoFemaleParticipants ?? 0) +
      (doc.starsteamclubdemoFemaleParticipants ?? 0) +
      (doc.wholeschoolFemaleParticipants ?? 0) +
      (doc.onedaycompFemaleParticipants ?? 0);

    totals.totalTeachers +=
      (doc.teacherhubParticipants ?? 0) + (doc.starteacherhubParticipants ?? 0);

    totals.totalMaleTeachers +=
      (doc.teacherhubMaleParticipants ?? 0) +
      (doc.starteacherhubMaleParticipants ?? 0);

    totals.totalFemaleTeachers +=
      (doc.teacherhubFemaleParticipants ?? 0) +
      (doc.starteacherhubFemaleParticipants ?? 0);
  }

  // Create summary line with **ID first**, then all fields in dictionary order
  const RECORD_TYPE = "1"; // or "A" depending on your CSPro record setup

  const summaryLine =
    RECORD_TYPE + // record type first!
    formatField2(1, 6, "right") +
    formatField2(
      totals.teachersBaselinePerception,
      FIELD_WIDTHS.teachers_participated_baseline_perception,
      "right"
    ) +
    formatField2(
      totals.teachersEndlinePerception,
      FIELD_WIDTHS.teachers_participated_endline_perception,
      "right"
    ) +
    formatField2(
      totals.steamclubActs,
      FIELD_WIDTHS.student_hands_on_activities,
      "right"
    ) +
    formatField2(
      totals.steamsafeerclubActs,
      FIELD_WIDTHS.steam_safeer_clubActs,
      "right"
    ) +
    formatField2(
      totals.teacherhubActs,
      FIELD_WIDTHS.teacher_hub_Acts,
      "right"
    ) +
    formatField2(
      totals.storysessionActs,
      FIELD_WIDTHS.story_session_Acts,
      "right"
    ) +
    formatField2(
      totals.steamclubdemoActs,
      FIELD_WIDTHS.steam_club_demo_Acts,
      "right"
    ) +
    formatField2(
      totals.wholeschoolActs,
      FIELD_WIDTHS.whole_school_Acts,
      "right"
    ) +
    formatField2(
      totals.onedaycompActs,
      FIELD_WIDTHS.oneday_steam_compActs,
      "right"
    ) +
    formatField2(
      totals.starsteamtotalActs,
      FIELD_WIDTHS.star_steam_total_Acts,
      "right"
    ) +
    formatField2(
      totals.totalActivities,
      FIELD_WIDTHS.total_acts_submitted,
      "right"
    ) +
    formatField2(
      totals.totalAccepted,
      FIELD_WIDTHS.total_acts_accepted,
      "right"
    ) +
    formatField2(
      totals.totalRejected,
      FIELD_WIDTHS.total_acts_rejected,
      "right"
    ) +
    formatField2(
      totals.totalPending,
      FIELD_WIDTHS.total_acts_under_review,
      "right"
    ) +
    formatField2(
      totals.totalStudents,
      FIELD_WIDTHS.total_Students_In_Steam_Club_Acts,
      "right"
    ) +
    formatField2(
      totals.totalMaleStudents,
      FIELD_WIDTHS.total_Male_Students_In_Steam_Club_Acts,
      "right"
    ) +
    formatField2(
      totals.totalFemaleStudents,
      FIELD_WIDTHS.total_Female_Students_In_Steam_Club_Acts,
      "right"
    ) +
    formatField2(
      totals.totalTeachers,
      FIELD_WIDTHS.total_Teachers_In_Steam_Club_Acts,
      "right"
    ) +
    formatField2(
      totals.totalMaleTeachers,
      FIELD_WIDTHS.total_Male_Teachers_In_Steam_Club_Acts,
      "right"
    ) +
    formatField2(
      totals.totalFemaleTeachers,
      FIELD_WIDTHS.total_Female_Teachers_In_Steam_Club_Acts,
      "right"
    );

  return summaryLine; // <-- return as plain string for CSPro
}

///////////////testing api
app.get("/test", async (req, res) => {
  res.send("Testing Env Api is Working");
  console.log("Server response");
});

///////////////login
app.post("/login", (req, res) => {
  try {
    const { name, password } = req.query;

    // Example: load from file or environment
    const user = { name: "portal_integration", password: "PAMS@$spi" };

    if (name == user.name && password == user.password) {
      const token = jwt.sign({ name }, process.env.EXPORT_API_TOKEN, {
        expiresIn: "1h",
      });
      return res.json({
        success: true,
        token,
      });
    }

    res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// =======================================
// 🧩 API Endpoint: /export/dat
// =======================================
app.get("/export/dat", authMiddleware, async (req, res) => {
  console.log("req", req.query);
  console.log("\n🔄 Starting .dat export process...");

  try {
    await client.connect();
    const db = client.db(dbName);

    const usersCollection = db.collection("users");
    const fromParam = req.query.from ? new Date(req.query.from) : null;
    const toParam = req.query.to ? new Date(req.query.to) : new Date();

    // Default lower bound (30 Sept 2025)
    const SEPT_30 = new Date("2025-09-30T00:00:00.000Z");

    // If user-provided 'from' date is before 30 Sep 2025, use 30 Sep 2025 instead
    const effectiveFrom =
      fromParam && fromParam > SEPT_30 ? fromParam : SEPT_30;

    // Always use provided 'to' date (or default to today)
    const effectiveTo = toParam;
    // =======================================
    // 🧩 Aggregation Pipeline
    // =======================================
    const records = await usersCollection
      .aggregate([
        // Only include users where ilm = true
        { $match: { ilm: true } },

        {
          $lookup: {
            from: "posts",
            let: {
              dt: true,
              rt: false,
              fd: false,
              sch: "$schoolName",
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $eq: ["$typeOfSession", "$$tos"] },
                      {
                        $gte: [
                          "$createdAt",
                          new Date("2025-09-17T00:00:00.000Z"),
                        ],
                      },
                      {
                        $eq: [
                          "$themeOfSession",
                          "STEAM Club Student Registration",
                        ],
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  numberOfParticipants: 1,
                  maleParticipants: 1,
                  femaleParticipants: 1,
                  createdAt: 1,
                },
              },
            ],
            as: "registration",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: {
              dt: true,
              rt: false,
              sch: "$schoolName",
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $eq: ["$typeOfSession", "$$tos"] },
                      {
                        $eq: [
                          "$themeOfSession",
                          "Teachers Base-line Perception Survey",
                        ],
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  createdAt: 1,
                  formDataCount: {
                    $add: [
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData1", null] },
                              { $ne: ["$formData1", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData2", null] },
                              { $ne: ["$formData2", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData3", null] },
                              { $ne: ["$formData3", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData4", null] },
                              { $ne: ["$formData4", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData5", null] },
                              { $ne: ["$formData5", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            as: "perception",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: {
              dt: true,
              rt: false,
              sch: "$schoolName",
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $eq: ["$typeOfSession", "$$tos"] },
                      {
                        $eq: ["$themeOfSession", "End-Line perception Survey"],
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  createdAt: 1,
                  formDataCount: {
                    $add: [
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData1", null] },
                              { $ne: ["$formData1", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData2", null] },
                              { $ne: ["$formData2", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData3", null] },
                              { $ne: ["$formData3", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData4", null] },
                              { $ne: ["$formData4", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData5", null] },
                              { $ne: ["$formData5", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            as: "endPerception",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: { sch: "$schoolName", tos: "Other" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $ne: ["$typeOfSession", "$$tos"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "TotalActs",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: {
              sch: "$schoolName",
              dt: true,
              rt: false,
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $ne: ["$typeOfSession", "$$tos"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "AcceptedActs",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: {
              sch: "$schoolName",
              dt: false,
              rt: true,
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $ne: ["$typeOfSession", "$$tos"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "RejectedActs",
          },
        },
        ////pending activites
        {
          $lookup: {
            from: "posts",
            let: {
              sch: "$schoolName",
              dt: false,
              rt: false,
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $ne: ["$typeOfSession", "$$tos"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "PendingActs",
          },
        },
        // Lookup school info
        {
          $lookup: {
            from: "schools",
            localField: "schoolName",
            foreignField: "SchoolName",
            as: "schoolInfo",
          },
        },
        { $unwind: { path: "$schoolInfo", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "posts",
            let: { dt: true, rt: false, sch: "$schoolName" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "userActivities",
          },
        },
        {
          $unwind: {
            path: "$userActivities",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: {
              userId: "$_id",
              name: "$name",
              email: "$email",
              phone: "$phone",
              province: "$province",
              district: "$district",
              cycle: "$cycle", // or "$cycle" depending on your user field name — adjust if needed
              level: "$level",
              typeOfSchool: "$typeOfSchool",
              tierOfSchool: "$tierOfSchool",
              role: "$role",
              schoolName: "$schoolName",
            },
            school: { $first: "$schoolInfo" }, // keep full school object
            registration: { $first: "$registration" },
            perception: { $first: "$perception" },
            endPerception: { $first: "$endPerception" },
            TotalActs: { $first: "$TotalActs" },
            AcceptedActs: { $first: "$AcceptedActs" },
            RejectedActs: { $first: "$RejectedActs" },
            PendingActs: { $first: "$PendingActs" },
            activities: {
              $push: {
                activityType: "$userActivities.typeOfSession",
                participants: {
                  $toInt: {
                    $ifNull: ["$userActivities.numberOfParticipants", 0],
                  },
                },
                males: {
                  $toInt: { $ifNull: ["$userActivities.maleParticipants", 0] },
                },
                females: {
                  $toInt: {
                    $ifNull: ["$userActivities.femaleParticipants", 0],
                  },
                },
                createdAt: "$userActivities.createdAt",
              },
            },
          },
        },
        ////level before 30 the september
        {
          $lookup: {
            from: "userlogs",
            let: { sch: "$school.SchoolName" }, // ✅ correct reference after grouping
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      {
                        $lt: [
                          "$createdAt",
                          new Date("2025-09-30T00:00:00.000Z"),
                        ],
                      },
                      {
                        $in: [
                          "$info",
                          [
                            "Level Up from 1 to 2",
                            "Level Up from 2 to 3",
                            "Level Up from 3 to 4",
                            "Level Up from 4 to 5",
                            "Level Up from 5 to 6",
                            "Level Up from 6 to 7",
                            "Level Up from 7 to 8",
                            "Level Up from 8 to 9",
                            "Level Up from 9 to 10",
                            "Level Up from 10 to 11",
                            "Level Up from 11 to 12",
                            "Level Up from 12 to 13",
                            "Level Up from 13 to 14",
                            "Level Up from 14 to 15",
                          ],
                        ],
                      },
                    ],
                  },
                },
              },
              { $sort: { createdAt: -1 } },
              { $limit: 1 },
              {
                $addFields: {
                  level: {
                    $toInt: {
                      $arrayElemAt: [
                        {
                          $map: {
                            input: {
                              $regexFindAll: { input: "$info", regex: /\d+/ },
                            },
                            as: "match",
                            in: "$$match.match",
                          },
                        },
                        1,
                      ],
                    },
                  },
                },
              },
              { $project: { level: 1, createdAt: 1 } },
            ],
            as: "schoolLevelBeforeSept",
          },
        },

        // Project required fields
        {
          $project: {
            _id: 0,
            name: "$_id.name",
            email: "$_id.email",
            phone: "$_id.phone",
            schoolName: "$_id.schoolName",
            province: "$_id.province",
            district: "$_id.district",
            cycle: "$_id.cycle",
            schoollevel: "$_id.level",
            typeOfSchool: "$_id.typeOfSchool",
            tierOfSchool: "$_id.tierOfSchool",
            role: "$_id.role",

            // school fields
            emiscode: "$school.Emiscode", // <-- comes from schools collection (schoolInfo)
            status: "$school.status", // <-- comes from schools collection
            createdAt: "$school.createdAt",
            // keep the registration/perception/endPerception arrays/objects you collected earlier
            registration: 1,
            perception: 1,
            endPerception: 1,
            activities: 1,
            totalActivities: { $size: "$TotalActs" },
            totalAccepted: { $size: "$AcceptedActs" },
            totalRejected: { $size: "$RejectedActs" },
            totalPending: { $size: "$PendingActs" },
            // activity type counters (ensure the strings match your actual typeOfSession values)
            ...activityProjections,
            levelBeforeSept: {
              $ifNull: [
                { $arrayElemAt: ["$schoolLevelBeforeSept.level", 0] },
                0,
              ],
            },
          },
        },
      ])
      .toArray();

    console.log(`📦 Fetched ${records.length} records from MongoDB`);

    if (records.length === 0) {
      throw new Error("No records found with ilm: true");
    }

    // =======================================
    // 🧩 Save .dat in Downloads folder
    // =======================================
    const isLocal = false;

    if (isLocal) {
      // ✅ LOCAL: Save files to Downloads folder
      const downloadsFolder = path.join(os.homedir(), "Downloads");
      if (!fs.existsSync(downloadsFolder)) {
        fs.mkdirSync(downloadsFolder, { recursive: true });
      }

      const datPath = createDatFile(downloadsFolder, records);
      const csvPath = createCsvFile(downloadsFolder, records);

      res.json({
        message: "✅ .dat and .csv files created in Downloads folder",
        datFilePath: datPath,
        csvFilePath: csvPath,
        count: records.length,
      });
    } else {
      // 🌍 DEPLOYED (Vercel or similar): Return CSV content with friendly headers
      console.log("🌍 Running in deployed mode — streaming CSV data");
      // Helper: format date like "17-Sep-2025"
      function formatDate(date) {
        if (!date) return "";
        const d = new Date(date);
        if (isNaN(d)) return "";
        const day = d.getDate().toString().padStart(2, "0");
        const month = d.toLocaleString("en-US", { month: "short" });
        const year = d.getFullYear();
        return `${day}-${month}-${year}`;
      }
      const headers = [
        "Province",
        "District",
        "EMIS Code",
        "School Name",
        "Type of School",
        "Tier of School",
        "Consent Form",
        "STEAM Journey Level of School",
        "Change in Level of School after 30th September",
        "STEAM Journey Cycle of School",
        "Focal Person",
        "Phone",
        "Email",
        "Designation",
        "Submission Date of STEAM Club Student Registration",
        "Number of Students Registered in STEAM Clubs",
        "Number of Male Students Registered in STEAM Clubs",
        "Number of Female Students Registered in STEAM Clubs",
        "Number of Teachers who Participated in Baseline Perception",
        "Number of Teachers who Participated in Endline Perception",
        "STEAM Club Activities",
        "STEAM Safeer Activities",
        "Teacher Hub Activities",
        "Storytelling Activities",
        "STEAM Club Demonstation Activities",
        "Whole School Activities",
        "One Day STEAM Competition",
        "STAR STEAM Club Activities",
        "Total Number of Activities Submitted by ILMPact School",
        "Total Number of Activities Approved",
        "Total Number of Activities Not Approved",
        "Total Number of Activities Under Review",
        "Total Number of Students Engaged in STEAM Club Activities",
        "Total Number of Male Students Engaged",
        "Total Number of Female Students Engaged",
        "Total Number of Teachers Engaged in STEAM Club Activities",
        "Total Number of Male Teachers Engaged",
        "Total Female Teachers in STEAM Club Activities",
        "Schools that Completed 5 Approved Activities",
      ];

      const rows = records.map((doc) => {
        const reg = doc.registration?.[0] || {};
        const perc = doc.perception?.[0] || {};
        const end = doc.endPerception?.[0] || {};

        const levelAfterSept = calculateLevelAfterSept(doc);

        // ✅ Always wrap fields in quotes and replace internal quotes
        const wrap = (val) => `"${(val ?? "").toString().replace(/"/g, '""')}"`;

        return [
          wrap(doc.province),
          wrap(doc.district),
          wrap(doc.emiscode),
          wrap(doc.schoolName),
          wrap(doc.typeOfSchool),
          wrap(doc.tierOfSchool),
          wrap(doc.status),
          wrap(doc.schoollevel),
          wrap(levelAfterSept),
          wrap(doc.cycle),
          wrap(doc.name),
          wrap(doc.phone),
          wrap(doc.email),
          wrap(doc.role),
          wrap(formatDate(reg.createdAt)),
          wrap(reg.numberOfParticipants),
          wrap(reg.maleParticipants),
          wrap(reg.femaleParticipants),
          wrap(perc.formDataCount),
          wrap(end.formDataCount),
          wrap(doc.steamclubActs),
          wrap(doc.steamsafeerclubActs),
          wrap(doc.teacherhubActs),
          wrap(doc.storysessionActs),
          wrap(doc.steamclubdemoActs),
          wrap(doc.wholeschoolActs),
          wrap(doc.onedaycompActs),
          wrap(
            (doc.starsteamclubActs || 0) +
              (doc.starsteamsafeerActs || 0) +
              (doc.starteacherhubActs || 0) +
              (doc.starstorysessionActs || 0) +
              (doc.starsteamclubdemoActs || 0)
          ),
          wrap(doc.totalActivities),
          wrap(doc.totalAccepted),
          wrap(doc.totalRejected),
          wrap(doc.totalPending),
          wrap(
            (doc.steamclubParticipants || 0) +
              (doc.starsteamclubParticipants || 0) +
              (doc.storysessionParticipants || 0) +
              (doc.starstorysessionParticipants || 0) +
              (doc.steamsafeerclubParticipants || 0) +
              (doc.starsteamsafeerParticipants || 0) +
              (doc.steamclubdemoParticipants || 0) +
              (doc.starsteamclubdemoParticipants || 0)
          ),
          wrap(
            (doc.steamclubMaleParticipants || 0) +
              (doc.starsteamclubMaleParticipants || 0) +
              (doc.storysessionMaleParticipants || 0) +
              (doc.starstorysessionMaleParticipants || 0) +
              (doc.steamsafeerclubMaleParticipants || 0) +
              (doc.starsteamsafeerMaleParticipants || 0) +
              (doc.steamclubdemoMaleParticipants || 0) +
              (doc.starsteamclubdemoMaleParticipants || 0)
          ),
          wrap(
            (doc.steamclubFemaleParticipants || 0) +
              (doc.starsteamclubFemaleParticipants || 0) +
              (doc.storysessionFemaleParticipants || 0) +
              (doc.starstorysessionFemaleParticipants || 0) +
              (doc.steamsafeerclubFemaleParticipants || 0) +
              (doc.starsteamsafeerFemaleParticipants || 0) +
              (doc.steamclubdemoFemaleParticipants || 0) +
              (doc.starsteamclubdemoFemaleParticipants || 0)
          ),
          wrap(
            (doc.teacherhubParticipants || 0) +
              (doc.starteacherhubParticipants || 0)
          ),
          wrap(
            (doc.teacherhubMaleParticipants || 0) +
              (doc.starteacherhubMaleParticipants || 0)
          ),
          wrap(
            (doc.teacherhubFemaleParticipants || 0) +
              (doc.starteacherhubFemaleParticipants || 0)
          ),
          wrap(doc.totalAccepted >= 5 ? "Yes" : "No"),
        ].join(",");
      });

      // ✅ Add UTF-8 BOM and consistent line breaks
      // const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");

      // res.setHeader("Content-Disposition", "inline; filename=export.csv");
      // res.setHeader("Content-Type", "text/csv; charset=utf-8");
      // res.send(csvContent);

      const datContent = createDatFile(records); // return string or buffer

      res.setHeader("Content-Disposition", "attachment; filename=records.dat");
      res.setHeader("Content-Type", "application/octet-stream");
      res.send(datContent);
    }
  } catch (err) {
    console.error("❌ Error during export:", err);
    res.status(500).json({
      error: "Failed to export data",
      details: err.message,
    });
  } finally {
    await client.close();
  }
});

///////////////////////////////////////////////////////////////////////////////////////////////////////
app.get("/export/summary", authMiddleware, async (req, res) => {
  console.log("req", req.query);
  console.log("\n🔄 Starting .dat export process...");

  try {
    await client.connect();
    const db = client.db(dbName);

    const usersCollection = db.collection("users");
    const fromParam = req.query.from ? new Date(req.query.from) : null;
    const toParam = req.query.to ? new Date(req.query.to) : new Date();

    // Default lower bound (30 Sept 2025)
    const SEPT_30 = new Date("2025-09-30T00:00:00.000Z");

    // If user-provided 'from' date is before 30 Sep 2025, use 30 Sep 2025 instead
    const effectiveFrom =
      fromParam && fromParam > SEPT_30 ? fromParam : SEPT_30;

    // Always use provided 'to' date (or default to today)
    const effectiveTo = toParam;
    // =======================================
    // 🧩 Aggregation Pipeline
    // =======================================
    const newrecords = await usersCollection
      .aggregate([
        // Only include users where ilm = true
        { $match: { ilm: true } },

        {
          $lookup: {
            from: "posts",
            let: {
              dt: true,
              rt: false,
              fd: false,
              sch: "$schoolName",
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $eq: ["$typeOfSession", "$$tos"] },
                      {
                        $gte: [
                          "$createdAt",
                          new Date("2025-09-17T00:00:00.000Z"),
                        ],
                      },
                      {
                        $eq: [
                          "$themeOfSession",
                          "STEAM Club Student Registration",
                        ],
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  numberOfParticipants: 1,
                  maleParticipants: 1,
                  femaleParticipants: 1,
                  createdAt: 1,
                },
              },
            ],
            as: "registration",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: {
              dt: true,
              rt: false,
              sch: "$schoolName",
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $eq: ["$typeOfSession", "$$tos"] },
                      {
                        $eq: [
                          "$themeOfSession",
                          "Teachers Base-line Perception Survey",
                        ],
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  createdAt: 1,
                  formDataCount: {
                    $add: [
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData1", null] },
                              { $ne: ["$formData1", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData2", null] },
                              { $ne: ["$formData2", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData3", null] },
                              { $ne: ["$formData3", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData4", null] },
                              { $ne: ["$formData4", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData5", null] },
                              { $ne: ["$formData5", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            as: "perception",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: {
              dt: true,
              rt: false,
              sch: "$schoolName",
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $eq: ["$typeOfSession", "$$tos"] },
                      {
                        $eq: ["$themeOfSession", "End-Line perception Survey"],
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  createdAt: 1,
                  formDataCount: {
                    $add: [
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData1", null] },
                              { $ne: ["$formData1", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData2", null] },
                              { $ne: ["$formData2", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData3", null] },
                              { $ne: ["$formData3", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData4", null] },
                              { $ne: ["$formData4", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$formData5", null] },
                              { $ne: ["$formData5", {}] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            as: "endPerception",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: { sch: "$schoolName", tos: "Other" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $ne: ["$typeOfSession", "$$tos"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "TotalActs",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: {
              sch: "$schoolName",
              dt: true,
              rt: false,
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $ne: ["$typeOfSession", "$$tos"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "AcceptedActs",
          },
        },
        {
          $lookup: {
            from: "posts",
            let: {
              sch: "$schoolName",
              dt: false,
              rt: true,
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $ne: ["$typeOfSession", "$$tos"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "RejectedActs",
          },
        },
        ////pending activites
        {
          $lookup: {
            from: "posts",
            let: {
              sch: "$schoolName",
              dt: false,
              rt: false,
              tos: "Other",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $ne: ["$typeOfSession", "$$tos"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "PendingActs",
          },
        },
        // Lookup school info
        {
          $lookup: {
            from: "schools",
            localField: "schoolName",
            foreignField: "SchoolName",
            as: "schoolInfo",
          },
        },
        { $unwind: { path: "$schoolInfo", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "posts",
            let: { dt: true, rt: false, sch: "$schoolName" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$schoolName", "$$sch"] },
                      { $eq: ["$districtStatus", "$$dt"] },
                      { $eq: ["$rejectedStatus", "$$rt"] },
                      { $gte: ["$createdAt", effectiveFrom] },
                      { $lte: ["$createdAt", effectiveTo] },
                    ],
                  },
                },
              },
            ],
            as: "userActivities",
          },
        },
        {
          $unwind: {
            path: "$userActivities",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: {
              userId: "$_id",
              name: "$name",
              email: "$email",
              phone: "$phone",
              province: "$province",
              district: "$district",
              cycle: "$cycle", // or "$cycle" depending on your user field name — adjust if needed
              level: "$level",
              typeOfSchool: "$typeOfSchool",
              tierOfSchool: "$tierOfSchool",
              role: "$role",
              schoolName: "$schoolName",
            },
            school: { $first: "$schoolInfo" }, // keep full school object
            registration: { $first: "$registration" },
            perception: { $first: "$perception" },
            endPerception: { $first: "$endPerception" },
            TotalActs: { $first: "$TotalActs" },
            AcceptedActs: { $first: "$AcceptedActs" },
            RejectedActs: { $first: "$RejectedActs" },
            PendingActs: { $first: "$PendingActs" },
            activities: {
              $push: {
                activityType: "$userActivities.typeOfSession",
                participants: {
                  $toInt: {
                    $ifNull: ["$userActivities.numberOfParticipants", 0],
                  },
                },
                males: {
                  $toInt: { $ifNull: ["$userActivities.maleParticipants", 0] },
                },
                females: {
                  $toInt: {
                    $ifNull: ["$userActivities.femaleParticipants", 0],
                  },
                },
                createdAt: "$userActivities.createdAt",
              },
            },
          },
        },

        // Project required fields
        {
          $project: {
            _id: 0,
            name: "$_id.name",
            email: "$_id.email",
            phone: "$_id.phone",
            schoolName: "$_id.schoolName",
            province: "$_id.province",
            district: "$_id.district",
            cycle: "$_id.cycle",
            schoollevel: "$_id.level",
            typeOfSchool: "$_id.typeOfSchool",
            tierOfSchool: "$_id.tierOfSchool",
            role: "$_id.role",

            // school fields
            emiscode: "$school.Emiscode", // <-- comes from schools collection (schoolInfo)
            status: "$school.status", // <-- comes from schools collection
            createdAt: "$school.createdAt",
            // keep the registration/perception/endPerception arrays/objects you collected earlier
            registration: 1,
            perception: 1,
            endPerception: 1,
            activities: 1,
            totalActivities: { $size: "$TotalActs" },
            totalAccepted: { $size: "$AcceptedActs" },
            totalRejected: { $size: "$RejectedActs" },
            totalPending: { $size: "$PendingActs" },
            // activity type counters (ensure the strings match your actual typeOfSession values)
            ...activityProjections,
          },
        },
      ])
      .toArray();

    // =======================================
    // 🧩 Save .dat in Downloads folder
    // =======================================

    const datContent = createDatSummary(newrecords); // return string or buffer

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=summary-records.dat"
    );
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(datContent);
  } catch (err) {
    console.error("❌ Error during export:", err);
    res.status(500).json({
      error: "Failed to export data",
      details: err.message,
    });
  } finally {
    await client.close();
  }
});

// =======================================
// 🧩 Start Server
// =======================================
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`✅ API running at: http://localhost:${PORT}/export/dat`);
});
