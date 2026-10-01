import React, { useState, useEffect } from "react";
import { ArtificialWebPortal } from "./scripts/artificialW";
import { motion } from "framer-motion";
import { showErrorToast, showSuccessToast, showWarningToast, showLoadingToast, updateToastError, updateToastSuccess } from "@/lib/toastUtils";
import useTheme from "@/context/ThemeContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Tabs, TabsTrigger, TabsContent, TabsList } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, ChevronRight, Archive, Calculator, BarChart3, GraduationCap, ListFilter, SortAsc, SortDesc, HelpCircle, FileText, AlertTriangle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Helmet } from 'react-helmet-async';
import { proxy_url } from "@/lib/api";
import {
  saveToCache,
  getFromCache,
} from "@/components/scripts/cache";
import { getGradesActiveTab, setGradesActiveTab, getMarksSelectedSemester, setMarksSelectedSemester, getUsername } from '@/components/scripts/cache';
import GradeCard from "./GradeCard";
import MarksCard from "./MarksCard";
import SemCard from "./SemCard";
import { gradePointMap } from "@/lib/math";

// Consolidated payload serializer import from isolated utility module
import { serialize_payload } from "@/lib/jiitCrypto";

export default function Grades({
  w,
  setGradesData,
  semesterData,
  setSemesterData,
  activeTab,
  setActiveTab,
  gradeCardSemesters,
  setGradeCardSemesters,
  selectedGradeCardSem,
  setSelectedGradeCardSem,
  gradeCard,
  setGradeCard,
  gradeCards,
  setGradeCards,
  marksSemesters,
  setMarksSemesters,
  selectedMarksSem,
  setSelectedMarksSem,
  marksData,
  setMarksData,
  marksSemesterData,
  setMarksSemesterData,
  gradesLoading,
  setGradesLoading,
  gradesError,
  setGradesError,
  gradeCardLoading,
  setGradeCardLoading,
  isDownloadDialogOpen,
  setIsDownloadDialogOpen,
  marksLoading,
  setMarksLoading,
}) {
  const isOffline = w && (w instanceof ArtificialWebPortal || (w.constructor && w.constructor.name === 'ArtificialWebPortal'))
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { themeMode } = useTheme();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingGradeReport, setIsDownloadingGradeReport] = useState(false);
  const [marksCacheTimestamp, setMarksCacheTimestamp] = useState(null);
  const [gradeSort, setGradeSort] = useState('default');
  const [creditSort, setCreditSort] = useState('default');
  const [isMarksRefreshing, setIsMarksRefreshing] = useState(false);
  const [isMarksFromCache, setIsMarksFromCache] = useState(false);
  const [marksError, setMarksError] = useState(null);
  const [selectedSemesterDetail, setSelectedSemesterDetail] = useState(null);
  const [isSemesterDialogOpen, setIsSemesterDialogOpen] = useState(false);

  // Safely references dynamic session tokens extracted straight from the auth payload state
  const getGradesRawData = () => {
    if (!w?.session) return {};
    return {
      studentname: w.session.name || "",
      enrollmentno: w.session.enrollmentno || "",
      instituteid: w.session.instituteid || "",
      programmcode: w.session.regdata?.programcode || w.session.programcode || "BTECH", 
      branchcode: w.session.regdata?.branchcode || w.session.branchdesc || ""
    };
  };

  // DEEP STRUCTURE PARSER: Captures raw subject objects under any key permutation or flat list returns
  const getGradeCardItems = (card) => {
    if (!card) return [];
    if (Array.isArray(card)) return card;
    if (Array.isArray(card?.response?.gradecard)) return card.response.gradecard;
    if (Array.isArray(card?.gradecard)) return card.gradecard;
    if (Array.isArray(card?.response)) return card.response;
    
    // Checks for alternate naming configurations or key mutations deployed dynamically
    const nestedOption = card?.response?.response || card?.response?.studentInfo || card?.studentInfo || card?.registrations || card?.response?.registrations || card?.courses || card?.response?.courses;
    if (Array.isArray(nestedOption)) return nestedOption;

    // Direct object key scanner fallback layout rule
    for (const key in card) {
      if (Array.isArray(card[key]) && card[key].length > 0) {
        return card[key];
      }
      if (card[key] && typeof card[key] === 'object') {
        for (const subKey in card[key]) {
          if (Array.isArray(card[key][subKey])) return card[key][subKey];
        }
      }
    }
    return [];
  };

  const getGradeCardCreditsTotal = (card) => {
    return getGradeCardItems(card).reduce((sum, item) => sum + (Number(item?.coursecreditpoint ?? item?.credits ?? item?.earnedcredit ?? 0) || 0), 0);
  };
  const marksFetchInFlight = React.useRef(new Set());
  const lastRefreshRef = React.useRef({});
  // registration_id of the marks semester on screen; fetches that land for another one are
  // still kept and cached, they just don't replace what's displayed.
  const shownMarksRegIdRef = React.useRef(null);
  // Per-student key. WebPortal has no `username`, so the old `w.username || "user"` gave every
  // account on the device the same key and could show one student another's marks.
  const marksCacheKey = (sem) => `marks-${sem.registration_code}-${getUsername() || "user"}`;

  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl && ["overview", "marks", "semester"].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    } else {
      setActiveTab("overview");
      setSearchParams({ tab: "overview" }, { replace: true });
      setGradesActiveTab("overview");
    }
  }, []);

  const handleTabChange = (value) => {
    setActiveTab(value);
    setSearchParams({ tab: value });
    setGradesActiveTab(value);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (semesterData) {
          setGradesLoading(false);
          return;
        }
        const data = await w.get_sgpa_cgpa();
        if (!data || Object.keys(data).length === 0) {
          setGradesError(isOffline ? "Grades aren't available offline" : "Grade sheet is not available");
          return;
        }
        setGradesError(null);
        setGradesData(data);
        setSemesterData(data.semesterList);
      } catch (err) {
        if (err?.message?.includes("Unexpected end of JSON input")) {
          showWarningToast("Grade Sheet", "Grade sheet is not available yet");
          setGradesError("Grade sheet is not available");
        } else {
          showErrorToast("Grade Data Error", "Failed to fetch grade data");
          setGradesError("Failed to fetch grade data");
        }
      } finally {
        setGradesLoading(false);
      }
    };
    // Runs offline too (the offline portal reads cached grades); skipping it left
    // gradesLoading stuck at true.
    fetchData();
  }, [w, semesterData, isOffline]);

  useEffect(() => {
    const fetchGradeCardSemesters = async () => {
      if (!isOffline && (gradeCardSemesters.length === 0 || !gradeCard)) {
        setGradeCardLoading(true);
        try {
          let semesters = gradeCardSemesters;
          if (semesters.length === 0) {
            semesters = await w.get_semesters_for_grade_card();
            setGradeCardSemesters(semesters);
          }

          if (semesters.length > 0 && !selectedGradeCardSem) {
            const latestSemester = semesters[0];
            setSelectedGradeCardSem(latestSemester);
            const data = await w.get_grade_card(latestSemester);
            data.semesterId = latestSemester.registration_id;
            setGradeCard(data);
            setGradeCards((prev) => ({
              ...prev,
              [latestSemester.registration_id]: data,
            }));
          }
        } catch (err) {
          console.error("Failed to fetch grade card semesters:", err);
          showWarningToast("Grade Card Warning", "Could not load grade card data");
        } finally {
          setGradeCardLoading(false);
        }
      }
    };
    fetchGradeCardSemesters();
  }, [w, isOffline]);

  useEffect(() => {
    const fetchMarksSemesters = async () => {
      if (marksSemesters.length === 0 && !isOffline) {
        try {
          const sems = await w.get_semesters_for_marks();
          setMarksSemesters(sems);
        } catch (err) {
          console.error("Failed to fetch marks semesters:", err);
          showWarningToast("Marks Data", "Could not load marks semesters");
        }
      }
    };
    fetchMarksSemesters();
  }, [w, isOffline]);

  useEffect(() => {
    if (activeTab === 'marks' && marksSemesters.length > 0) {
      const storedSemester = getMarksSelectedSemester();
      const matchedSemester = storedSemester
        ? marksSemesters.find(sem =>
            sem.registration_id === storedSemester.registration_id ||
            sem.registration_code === storedSemester.registration_code
          )
        : null;

      if (!selectedMarksSem && matchedSemester) {
        setSelectedMarksSem(matchedSemester);
        return;
      }

      if (!selectedMarksSem) {
        const currentYear = new Date().getFullYear().toString();
        const currentYearSemester = marksSemesters.find(sem =>
          sem.registration_code && sem.registration_code.includes(currentYear)
        );
        setSelectedMarksSem(currentYearSemester || marksSemesters[0]);
      }
    }
  }, [marksSemesters, activeTab, selectedMarksSem]);

  useEffect(() => {
    if (activeTab !== 'marks' || isOffline) return;
    const processPdfMarks = async () => {
      if (!selectedMarksSem) return;
      const regId = selectedMarksSem.registration_id;
      shownMarksRegIdRef.current = regId;
      setMarksError(null);
      if (marksData[regId]) {
        setMarksSemesterData(marksData[regId]);
        setMarksLoading(false);
        return;
      }
      setMarksLoading(true);
      const cached = await getFromCache(marksCacheKey(selectedMarksSem));
      if (shownMarksRegIdRef.current !== regId) return;
      if (cached) {
        setMarksSemesterData(cached.data || cached);
        setMarksData((prev) => ({
          ...prev,
          [regId]: cached.data || cached,
        }));
        setMarksCacheTimestamp(cached.timestamp || null);
        setIsMarksFromCache(true);
        setMarksLoading(false);
        const cacheTs = cached.timestamp || 0;
        if (Date.now() - cacheTs > 10 * 60 * 1000) {
          setIsMarksRefreshing(true);
          await fetchFreshMarksData();
          setIsMarksRefreshing(false);
        }
        return;
      }
      await fetchFreshMarksData();
    };
    const fetchFreshMarksData = async () => {
      const sem = selectedMarksSem;
      const regId = sem.registration_id;
      const isShown = () => shownMarksRegIdRef.current === regId;
      // Already loading this semester; that fetch updates the view when it lands.
      if (marksFetchInFlight.current.has(regId)) return;
      const last = lastRefreshRef.current[regId];
      if (last && Date.now() - last < 10 * 60 * 1000) {
        setMarksLoading(false);
        return;
      }
      marksFetchInFlight.current.add(regId);
      let toastId;
      try {
        toastId = showLoadingToast(`Loading marks for ${sem.registration_code}...`, `marks-loading-${regId}`);
        const ENDPOINT = `/studentsexamview/printstudent-exammarks/${w.session.instituteid}/${sem.registration_id}/${sem.registration_code}`;
        const headers = await w.session.get_headers();
        const { getPyodideWithPackages } = await import("@/lib/pyodide");
        const pyodide = await getPyodideWithPackages();
        const fetchRes = await fetch(proxy_url + ENDPOINT, { method: "GET", headers });
        if (!fetchRes.ok) throw new Error("Failed to fetch marks PDF");
        const arrayBuffer = await fetchRes.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        pyodide.globals.set("data", pyodide.toPy(uint8));
        const res = await pyodide.runPythonAsync(`
          import pymupdf
          from jiit_marks import parse_report
          doc = pymupdf.Document(stream=bytes(data))
          marks = parse_report(doc)
          marks
        `);
        try { pyodide.globals.delete("data"); } catch (e) { }
        const result = res.toJs({
          dict_converter: Object.fromEntries,
          create_pyproxies: false,
        });
        // Keep and cache the result even if another semester is on screen by now.
        setMarksData((prev) => ({
          ...prev,
          [regId]: result,
        }));
        await saveToCache(marksCacheKey(sem), result, 240);
        lastRefreshRef.current[regId] = Date.now();
        updateToastSuccess(toastId, "Marks loaded", "Marks data has been refreshed.");
        if (isShown()) {
          setMarksSemesterData(result);
          setMarksCacheTimestamp(Date.now());
          setIsMarksFromCache(false);
        }
      } catch (error) {
        console.error("Failed to load marks:", error);
        const rawMessage = String(error?.message || "Could not load marks data");
        const normalized = rawMessage.toLowerCase();
        let userMessage = rawMessage;

        if (normalized.includes("table not on page") || normalized.includes("indexerror") || normalized.includes("no table")) {
          userMessage = "No marks table was found in the downloaded PDF for this semester.";
        } else if (normalized.includes("failed to fetch marks pdf")) {
          userMessage = "Could not download the marks PDF for this semester.";
        }

        if (toastId) updateToastError(toastId, "Marks load failed", userMessage);
        if (!isShown()) return;
        setMarksError(userMessage);
        setMarksSemesterData({ courses: [] });
        showErrorToast("Marks Load Error", userMessage);
      } finally {
        if (isShown()) setMarksLoading(false);
        marksFetchInFlight.current.delete(regId);
      }
    };
    if (selectedMarksSem) processPdfMarks();
  }, [selectedMarksSem, activeTab]);

  const handleSemesterChange = async (value) => {
    setGradeCardLoading(true);
    try {
      const semester = gradeCardSemesters.find((sem) => sem.registration_id === value);
      setSelectedGradeCardSem(semester);
      if (gradeCards[value]) {
        setGradeCard(gradeCards[value]);
      } else {
        const data = await w.get_grade_card(semester);
        data.semesterId = value;
        setGradeCard(data);
        setGradeCards((prev) => ({ ...prev, [value]: data }));
      }
    } catch (error) {
      console.error("Failed to fetch grade card:", error);
      showErrorToast("Grade Card Error", "Could not load component data parameters for the selected semester.");
    } finally {
      setGradeCardLoading(false);
    }
  };

  const loadGradeCard = async (sem) => {
    if (gradeCards[sem.registration_id]) return gradeCards[sem.registration_id];
    const card = await w.get_grade_card(sem);
    if (card) {
      card.semesterId = sem.registration_id;
      setGradeCards(prev => ({ ...prev, [sem.registration_id]: card }));
    }
    return card;
  };

  // Registration ids/codes an object carries (the field names differ between endpoints).
  const registrationKeys = (obj) =>
    [obj?.registration_id, obj?.registrationid, obj?.registration_code, obj?.registrationcode]
      .filter((v) => v !== undefined && v !== null && v !== "")
      .map(String);
  const sameRegistration = (a, b) => {
    const keys = registrationKeys(b);
    return registrationKeys(a).some((k) => keys.includes(k));
  };

  // Pairs a grade card with its SGPA-summary row, which carries no registration id. The earned
  // credits and SGPA points on the card's courses add up to that row's totals. (The courses'
  // own stynumber is the student's current semester, not the course's, so it can't be used.)
  const gradeCardMatchesSemRow = (card, row) => {
    let earned = 0, sgpaPoints = 0;
    for (const c of getGradeCardItems(card)) {
      earned += parseFloat(c.earnedcredit) || 0;
      sgpaPoints += parseFloat(c.sgpapoints) || 0;
    }
    return earned > 0
      && Math.abs(Number(row.totalearnedcredit ?? row.totalearnedcredits) - earned) < 0.01
      && Math.abs(Number(row.totalpointsecuredsgpa) - sgpaPoints) < 0.01;
  };
  const uniqueSemRowFor = (card) => {
    const rows = (semesterData || []).filter((row) => gradeCardMatchesSemRow(card, row));
    return rows.length === 1 ? rows[0] : null;
  };

  // Pairs a semester's SGPA-summary row (stynumber, SGPA, CGPA) with its grade-card registration
  // (courses). Throws rather than guessing, so a report never mixes two semesters' data.
  const resolveReportSemester = async (semRow, registrations) => {
    if (semRow) {
      let registration = registrations.find((s) => sameRegistration(semRow, s));
      let card = registration ? await loadGradeCard(registration) : null;
      if (!registration) {
        for (const s of registrations) {
          if (s.is_grade_card_complete === false) continue;
          const candidate = await loadGradeCard(s).catch(() => null);
          if (candidate && uniqueSemRowFor(candidate) === semRow) {
            registration = s;
            card = candidate;
            break;
          }
        }
      }
      if (!registration) throw new Error(`Couldn't find the grade card for Semester ${semRow.stynumber}.`);
      return { registration, card, semRow };
    }

    const registration = selectedGradeCardSem;
    if (!registration) throw new Error("Select a semester first.");
    const card = await loadGradeCard(registration);
    const row = (semesterData || []).find((r) => sameRegistration(r, registration)) || (card && uniqueSemRowFor(card));
    if (!row) throw new Error(`Couldn't match ${registration.registration_code} to a semester in your SGPA summary.`);
    return { registration, card, semRow: row };
  };

  const handleDownloadGradeReport = async (targetSemCard = null) => {
    const label = targetSemCard ? `Semester ${targetSemCard.stynumber}` : (selectedGradeCardSem?.registration_code || "the selected semester");

    setIsDownloadingGradeReport(true);
    const toastId = showLoadingToast(`Preparing grade report for ${label}...`, "grade-report-dl");
    try {
      let currentGradeCardSems = gradeCardSemesters;
      if (currentGradeCardSems.length === 0) {
        currentGradeCardSems = await w.get_semesters_for_grade_card();
        setGradeCardSemesters(currentGradeCardSems);
      }

      const { card: detailedCoursesObj, semRow } = await resolveReportSemester(targetSemCard, currentGradeCardSems);
      const semNumber = semRow.stynumber;

      const rawCoursesArray = getGradeCardItems(detailedCoursesObj);
      if (!rawCoursesArray || rawCoursesArray.length === 0) {
        throw new Error("The portal returned an empty file table block for this semester code.");
      }

      let totalGradePoints = 0, totalCourseCredits = 0, totalEarnedCredits = 0, totalSgpaPoints = 0, totalCgpaPoints = 0;
      
      const formattedCoursesList = rawCoursesArray.map(c => {
        const gp = parseFloat(c.gradepoint ?? c.gradePoint ?? gradePointMap[c.grade] ?? 0);
        const cr = parseFloat(c.coursecreditpoint ?? c.credits ?? c.course_credits ?? 0);
        const ec = parseFloat(c.earnedcredit ?? c.earned_credit ?? cr);
        const sp = parseFloat(c.sgpapoint ?? c.sgpaPoint ?? (gp * cr));
        const cp = parseFloat(c.cgpapoint ?? c.cgpaPoint ?? sp);

        totalGradePoints += gp;
        totalCourseCredits += cr;
        totalEarnedCredits += ec;
        totalSgpaPoints += sp;
        totalCgpaPoints += cp;

        return {
          subjectcode: c.subjectcode || c.subject_code || c.subjectid || "",
          subjectdesc: c.subjectdesc || c.subject_desc || c.subjectname || "",
          gradepoint: String(gp),
          course_credits: String(cr),  
          earned_credit: String(ec),   
          sgpapoint: String(sp),       
          cgpapoint: String(cp),       
          grade: c.grade || "",
          passfail: c.passfail || (c.grade === "F" ? "Y" : "N"),
          minorsubject: c.minorsubject || "N"
        };
      });

      // Appends explicit "Total" row structural tracking values
      formattedCoursesList.push({
        subjectdesc: "Total",
        gradepoint: String(totalGradePoints),
        course_credits: String(totalCourseCredits),
        earned_credit: String(totalEarnedCredits),
        sgpapoint: String(totalSgpaPoints),
        cgpapoint: String(totalCgpaPoints),
        grade: "",
        passfail: "",
        minorsubject: ""
      });

      const ENDPOINT = "/studentsgpacgpa/semesterwisestudentresultreport";
      const currentHeaders = await w.session.get_headers();
      const localname = currentHeaders.LocalName || currentHeaders.localname;
      const studentMeta = getGradesRawData();

      const rawPayload = {
        studentname: studentMeta.studentname,
        instituteid: studentMeta.instituteid,
        studentinfolist: formattedCoursesList, 
        sgpa: String(semRow.sgpa ?? ""),
        cgpa: String(semRow.cgpa ?? ""),
        enrollmentno: studentMeta.enrollmentno,
        programmcode: studentMeta.programmcode, 
        branchcode: studentMeta.branchcode,
        stynumber: String(semNumber)
      };

      const securePayload = await serialize_payload(rawPayload);

      let downloadUrl = w.apiUrl + ENDPOINT;
      if (w.useProxy) {
        let endpoint = downloadUrl.replace(w.apiUrl, "");
        downloadUrl = `${w.proxyUrl}/proxy${endpoint}`;
      }

      const resp = await fetch(downloadUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...currentHeaders,
          "LocalName": localname
        },
        body: JSON.stringify(securePayload)
      });

      if (!resp.ok) throw new Error(`Portal returned error status ${resp.status}`);

      const blob = await resp.blob();
      
      if (blob.size <= 400) { 
        const errContext = await blob.text();
        console.error("Intercepted exception response stream text:", errContext);
        throw new Error("Portal backend compiled a blank document block. Confirm all selected parameters match structural verification sets.");
      }

      const contentType = resp.headers.get("content-type") || "";
      if (contentType.toLowerCase().includes("json")) {
        throw new Error("Server processed an internal layout parsing error container instead of an official asset file stream.");
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `grade_report_semester_${semNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      updateToastSuccess(toastId, "Download complete", "Your official Grade Report PDF has been downloaded successfully.");
    } catch (err) {
      console.error("Grade Report handling exception:", err);
      updateToastError(toastId, "Download failed", err?.message || "Failed to finalize official document streaming.");
      showErrorToast("Document Download Error", err?.message || "Portal server sent down an unreadable layout container.");
    } finally {
      setIsDownloadingGradeReport(false);
    }
  };

  const DetailStat = ({ label, value }) => (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );

  const getGradeColor = (grade) => {
    const gradeColors = {
      "A+": "text-green-400", A: "text-green-500", "B+": "text-yellow-400", B: "text-yellow-500",
      "C+": "text-yellow-600", C: "text-orange-400", D: "text-orange-500", F: "text-red-500",
    };
    return gradeColors[grade] || "text-white";
  };

  const toggleGradeSort = () => {
    setCreditSort('default');
    setGradeSort(prev => prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default');
  };

  const toggleCreditSort = () => {
    setGradeSort('default');
    setCreditSort(prev => prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default');
  };

  const handleMarksSemesterChange = async (value) => {
    const semester = marksSemesters.find((sem) => sem.registration_id === value);
    if (!semester) return;
    setSelectedMarksSem(semester);
    setMarksSelectedSemester(semester);
    // The marks themselves are loaded by the effect on selectedMarksSem, which knows which
    // semester is on screen. Loading them here too, after the await below, could put an
    // earlier semester's marks on screen. This only prefetches the grade card MarksCard uses.
    if (!gradeCards[value]) {
      try {
        const data = await w.get_grade_card(semester);
        if (data) {
          data.semesterId = value;
          setGradeCards((prev) => ({ ...prev, [value]: data }));
        }
      } catch (e) { }
    }
  };

  const fadeInUp = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
    transition: { duration: 0.3 },
  };

  const getTooltipStyle = () => ({
    backgroundColor: themeMode === 'dark' ? 'black' : 'white',
    border: themeMode === 'dark' ? '1px solid #374151' : '1px solid #d1d5db',
    borderRadius: '8px',
    color: themeMode === 'dark' ? 'white' : 'black',
    fontWeight: '500',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
  });

  const getTooltipLabelStyle = () => ({ color: themeMode === 'dark' ? 'white' : 'black' });

  if (gradesLoading) {
    return (
      <motion.div {...fadeInUp} className="flex items-center justify-center py-4 h-[60vh] text-foreground">
        <Loader2 className="w-8 h-8 animate-spin mr-2 text-foreground" />
        <span className="text-lg text-foreground">Loading grades...</span>
      </motion.div>
    );
  }

  const handleDownloadMarks = async (semester) => {
    setIsDownloading(true);
    const toastId = showLoadingToast("Downloading marks...", "Preparing the marks PDF.");
    try {
      await w.download_marks(semester);
      setIsDownloadDialogOpen(false);
      updateToastSuccess(toastId, "Download started", "Your marks PDF is downloading.");
    } catch (err) {
      console.error("Failed to download marks:", err);
      updateToastError(toastId, "Download failed", err?.message || "Unable to download marks.");
      showErrorToast("Marks Download Error", err?.message || "Failed to download marks.");
    } filll: {
      setIsDownloading(false);
    }
  };

  const isCurrentSemPartial = selectedGradeCardSem?.is_grade_card_complete === false || 
                             selectedGradeCardSem?.grade_card_source === "studentchoiceprint";

  return (
    <>
      <Helmet>
        <title>Grades & Marks - JP Portal</title>
      </Helmet>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="min-h-screen bg-background text-foreground pt-2 pb-24 px-3 md:px-6 font-sans text-sm max-[390px]:text-xs"
      >
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="w-full max-w-7xl mx-auto"
        >
          <div className="md:hidden">
            <TabsList className="grid w-full max-w-md mx-auto grid-cols-3 mb-4 rounded-lg p-1">
              {[
                { name: "overview", icon: BarChart3 },
                { name: "marks", icon: Download },
                { name: "semester", icon: GraduationCap }
              ].map((tab) => (
                <TabsTrigger
                  key={tab.name}
                  value={tab.name}
                  className="rounded-md transition-all duration-200 flex items-center justify-center gap-1"
                >
                  <motion.div className="flex items-center gap-1">
                    <tab.icon className="w-4 h-4 hidden md:inline" />
                    <span>{tab.name.charAt(0).toUpperCase() + tab.name.slice(1)}</span>
                  </motion.div>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="hidden md:block">
            <div className="flex justify-center mb-4">
              <div className="flex bg-muted/50 rounded-lg p-1">
                {[
                  { id: "overview", icon: BarChart3, label: "Overview" },
                  { id: "marks", icon: Download, label: "Marks" },
                  { id: "semester", icon: GraduationCap, label: "Semester" }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleTabChange(t.id)}
                    className={`px-4 py-1.5 rounded-md transition-all duration-200 flex items-center gap-2 ${activeTab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <t.icon className="w-4 h-4" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="w-full max-w-7xl mx-auto">
            <TabsContent value="overview">
              <motion.div {...fadeInUp} className="space-y-4">
                {gradesError ? (
                  <Alert variant="destructive">
                    <AlertDescription className="text-center">
                      <div className="text-xl font-semibold mb-2">{gradesError}</div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <motion.div className="bg-card rounded-lg p-4 border border-border shadow-md">
                      <h2 className="text-xl font-bold mb-4 text-center">Grade Progression</h2>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={semesterData} margin={{ top: 0, right: 10, left: 0, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="stynumber" stroke="#9CA3AF" label={{ value: "Semester", position: "bottom", fill: "#9CA3AF" }} />
                          <YAxis stroke="#9CA3AF" domain={["dataMin", "dataMax"]} tickCount={5} tickFormatter={(v) => v.toFixed(1)} />
                          <Tooltip contentStyle={getTooltipStyle()} labelStyle={getTooltipLabelStyle()} />
                          <Legend verticalAlign="top" height={36} />
                          <Line type="monotone" dataKey="sgpa" stroke="#4ADE80" name="SGPA" strokeWidth={3} dot={{ fill: "#4ADE80" }} />
                          <Line type="monotone" dataKey="cgpa" stroke="#60A5FA" name="CGPA" strokeWidth={3} dot={{ fill: "#60A5FA" }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </motion.div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                      {semesterData?.map((sem, idx) => (
                        <motion.div
                          key={sem.stynumber}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1 }}
                        >
                          <SemCard
                            semester={sem}
                            onClick={() => {
                              setSelectedSemesterDetail(sem);
                              setIsSemesterDialogOpen(true);
                            }}
                          />
                        </motion.div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                      <Button variant="outline" className="h-16 flex-col gap-1" onClick={() => navigate("/gpa-calculator")}>
                        <Calculator className="w-5 h-5 text-muted-foreground" />
                        <span className="text-xs">GPA Calculator</span>
                      </Button>
                      <Button variant="outline" className="h-16 flex-col gap-1" onClick={() => setIsDownloadDialogOpen(true)} disabled={isDownloading}>
                        <Download className="w-5 h-5 text-muted-foreground" />
                        <span className="text-xs">Download Marks</span>
                      </Button>
                    </div>
                  </>
                )}
              </motion.div>
            </TabsContent>
            <TabsContent value="semester">
              <motion.div {...fadeInUp} className="space-y-3">
                {gradeCardLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    <p className="text-muted-foreground animate-pulse">Fetching Grade Card...</p>
                  </div>
                ) : !gradeCard && gradeCardSemesters.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-xl">Grade card is not available yet</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 flex-wrap justify-between bg-card border border-border rounded-xl p-4 shadow-sm">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Select onValueChange={handleSemesterChange} value={selectedGradeCardSem?.registration_id}>
                          <SelectTrigger className="w-full md:w-[250px]">
                            <SelectValue placeholder="Select semester" />
                          </SelectTrigger>
                          <SelectContent>
                            {gradeCardSemesters.map(s => {
                              const isPartial = s.is_grade_card_complete === false || s.grade_card_source === "studentchoiceprint";
                              return (
                                <SelectItem key={s.registration_id} value={s.registration_id}>
                                  <div className="flex items-center gap-2">
                                    <span>{s.registration_code}</span>
                                    {isPartial && (
                                      <span className="text-[10px] text-amber-500 border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 rounded-md font-semibold tracking-wide">
                                        Tentative
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {gradeCard && (
                          <Badge variant="outline" className="px-3 py-2 text-sm gap-1">
                            Total Credits: <span className="font-bold">{getGradeCardCreditsTotal(gradeCard).toFixed(1)}</span>
                          </Badge>
                        )}
                        <ButtonGroup className="rounded-lg overflow-hidden border border-border">
                          <Button variant="ghost" size="sm" onClick={toggleGradeSort} className="gap-1 h-9">
                            <span className="text-xs">Grade</span>
                            {gradeSort === "asc" ? <SortAsc className="w-3.5 h-3.5" /> : gradeSort === "desc" ? <SortDesc className="w-3.5 h-3.5" /> : <ListFilter className="w-3.5 h-3.5" />}
                          </Button>
                          <ButtonGroupSeparator />
                          <Button variant="ghost" size="sm" onClick={toggleCreditSort} className="gap-1 h-9">
                            <span className="text-xs">Credit</span>
                            {creditSort === "asc" ? <SortAsc className="w-3.5 h-3.5" /> : creditSort === "desc" ? <SortDesc className="w-3.5 h-3.5" /> : <ListFilter className="w-3.5 h-3.5" />}
                          </Button>
                        </ButtonGroup>
                      </div>

                      {gradeCard && (
                        <Button 
                          variant="outline"
                          size="sm"
                          className="gap-2 ml-auto text-primary hover:bg-primary/5 border-primary/20"
                          onClick={() => handleDownloadGradeReport(null)}
                          disabled={isDownloadingGradeReport}
                        >
                          {isDownloadingGradeReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                          <span>Download Grade Report</span>
                        </Button>
                      )}
                    </div>
                    
                    {isCurrentSemPartial && (
                      <Alert className="border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400 max-w-7xl mx-auto py-3 shadow-sm rounded-xl">
                        <AlertDescription className="text-xs flex items-start gap-2.5 leading-relaxed">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500 mt-0.5" />
                          <div>
                            <span className="font-semibold block mb-0.5 text-amber-700 dark:text-amber-300">Tentative Semester Records Detected</span>
                            This file set was mapped using preliminary choice configuration arrays. Component totals and full records remain structural estimates until official verification sets are locked by the system administrators.
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {getGradeCardItems(gradeCard).sort((a, b) => {
                        if (gradeSort !== 'default') {
                          const diff = gradePointMap[a.grade] - gradePointMap[b.grade];
                          return gradeSort === 'asc' ? diff : -diff;
                        }
                        if (creditSort !== 'default') {
                          const diff = (a.coursecreditpoint ?? a.credits ?? 0) - (b.coursecreditpoint ?? b.credits ?? 0);
                          return creditSort === 'asc' ? diff : -diff;
                        }
                        return 0;
                      }).map(s => <GradeCard key={s.subjectcode || s.subjectid} subject={s} getGradeColor={getGradeColor} />)}
                    </div>
                  </div>
                )}
              </motion.div>
            </TabsContent>
            <TabsContent value="marks">
              <motion.div {...fadeInUp} className="space-y-4">
                {marksSemesters.length === 0 ? (
                  <div className="text-center py-8"><p className="text-xl">Marks data is not available yet</p></div>
                ) : (
                  <>
                    <Select onValueChange={handleMarksSemesterChange} value={selectedMarksSem?.registration_id}>
                      <SelectTrigger className="w-full md:w-[250px]"><SelectValue placeholder="Select semester" /></SelectTrigger>
                      <SelectContent>
                        {marksSemesters.map(s => <SelectItem key={s.registration_id} value={s.registration_id}>{s.registration_code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {isMarksFromCache && marksCacheTimestamp && (
                      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <Archive size={12} />
                        Cached: {new Date(marksCacheTimestamp).toLocaleString()}
                        {isMarksRefreshing && <Loader2 className="animate-spin w-3 h-3 ml-2" />}
                      </div>
                    )}
                    {marksLoading ? (
                      <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>
                    ) : marksError ? (
                      <div className="text-center py-10">
                        <p className="text-lg font-semibold text-destructive">{marksError}</p>
                        <p className="text-sm text-muted-foreground mt-2">Try selecting a different semester or download the marks PDF manually.</p>
                      </div>
                    ) : marksSemesterData?.courses?.length > 0 ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {marksSemesterData.courses.map(c => (
                            <MarksCard key={c.code} course={c} gradeInfo={gradeCards[selectedMarksSem?.registration_id]} />
                          ))}
                        </div>
                        <div className="flex justify-center">
                          <Button className="gap-2" onClick={() => setIsDownloadDialogOpen(true)} disabled={isDownloading}>
                            {isDownloading ? <Loader2 className="animate-spin h-4 w-4" /> : <Download className="h-4 w-4" />}
                            Download Marks
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-10">
                        <p className="text-xl">No marks found for this semester.</p>
                        <p className="text-sm text-muted-foreground mt-2">If the PDF contains no table or marks, try another semester or download the PDF directly.</p>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            </TabsContent>
          </div>
        </Tabs>
        
        {/* Quick Summary Semester Modal Dialog Container */}
        <Dialog open={isSemesterDialogOpen} onOpenChange={(open) => {
          setIsSemesterDialogOpen(open);
          if (!open) setSelectedSemesterDetail(null);
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader className="space-y-1">
              <div className="flex items-center justify-between pr-6">
                <div>
                  <DialogTitle className="text-base">Semester {selectedSemesterDetail?.stynumber || "Details"}</DialogTitle>
                  <DialogDescription className="text-xs">Quick semester summary.</DialogDescription>
                </div>
                
                {/* Embedded Action Download Trigger Header Button */}
                {selectedSemesterDetail && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 text-primary hover:bg-primary/5 border-primary/20 shadow-sm"
                    onClick={() => handleDownloadGradeReport(selectedSemesterDetail)}
                    disabled={isDownloadingGradeReport}
                  >
                    {isDownloadingGradeReport ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    <span className="text-xs">Download Report</span>
                  </Button>
                )}
              </div>
            </DialogHeader>
            {selectedSemesterDetail && (
              <div className="space-y-3 text-sm text-foreground pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <DetailStat label="SGPA" value={Number(selectedSemesterDetail.sgpa || 0).toFixed(2)} />
                  <DetailStat label="CGPA" value={Number(selectedSemesterDetail.cgpa || 0).toFixed(2)} />
                  <DetailStat label="Credits Registered" value={Number(selectedSemesterDetail.totalregisteredcredit || selectedSemesterDetail.registeredcredit || 0).toFixed(1)} />
                  <DetailStat label="Credits Earned" value={Number(selectedSemesterDetail.totalearnedcredit || selectedSemesterDetail.totalearnedcredits || 0).toFixed(1)} />
                  <DetailStat label="Earned Grade Points" value={Number(selectedSemesterDetail.earnedgradepoints || selectedSemesterDetail.totalpointsecuredsgpa || 0).toFixed(1)} />
                  <DetailStat label="Total Grade Points" value={Number(selectedSemesterDetail.totalgradepoints || selectedSemesterDetail.prograde || 0).toFixed(1)} />
                  <DetailStat label="SGPA Points" value={Number(selectedSemesterDetail.totalpointsecuredsgpa || 0).toFixed(1)} />
                  <DetailStat label="CGPA Points" value={Number(selectedSemesterDetail.totalpointsecuredcgpa || 0).toFixed(1)} />
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isDownloadDialogOpen} onOpenChange={setIsDownloadDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Download Marks</DialogTitle>
              <DialogDescription>Select semester</DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              {marksSemesters.map(s => (
                <Button key={s.registration_id} variant="ghost" className="w-full justify-between" onClick={() => handleDownloadMarks(s)} disabled={isDownloading}>
                  {s.registration_code}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>
    </>
  );
}