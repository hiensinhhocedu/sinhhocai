import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, UserRole, StudentCompetencyProfile, DiagnosticErrorItem } from '../types';
import { 
  SheetStudent, 
  ClassroomGroup, 
  fetchGoogleSheetStudents, 
  groupStudentsIntoClassrooms, 
  fetchGoogleSheetExamResults,
  getGoogleSheetUrl,
  getStudentGrade
} from '../services/dataService';

interface ReportViewProps {
  user: User;
  onNavigateToPersonalized?: (student: SheetStudent) => void;
  onNavigateToTest?: () => void;
}

// Helper lấy thuần Họ và Tên học sinh không kèm tiền tố lớp hoặc mã HS (Ví dụ: "Nguyễn Văn C")
export const cleanStudentFullName = (name: string, className?: string): string => {
  let clean = (name || '').trim();
  if (!clean) return 'Học sinh';
  
  if (className) {
    const cleanClass = className.trim();
    if (cleanClass) {
      const classRegex = new RegExp(`^${cleanClass}[_\\-\\s]+`, 'i');
      clean = clean.replace(classRegex, '');
    }
  }
  
  // Loại bỏ các tiền tố lớp định dạng [Khối][Lớp] (ví dụ: "10T6_", "12T7 - ", "11B1_") hoặc [Mã HS]_ (ví dụ: "10T601_")
  clean = clean.replace(/^[0-9]{1,2}[A-Za-z0-9]+[_\\-\\s]+/, '');
  
  return clean.trim() || clean;
};

// Helper format Họ và Tên theo định dạng [Lớp]_[Tên] (Ví dụ: 10T6_Nguyễn Văn A)
export const formatStudentReportName = (name: string, className?: string): string => {
  const cleanName = cleanStudentFullName(name, className);
  const cleanClass = (className || '').trim().toUpperCase();
  if (!cleanClass || cleanClass === 'CHƯA XẾP LỚP') {
    return cleanName || 'Học sinh';
  }
  return `${cleanClass}_${cleanName}`;
};

// Helper format hiển thị trong ô Chọn Học Sinh: ID_Họ_và_Tên (Ví dụ: 10T601_Nguyễn Văn A)
export const formatStudentSelectorOption = (student: SheetStudent): string => {
  const id = (student.id || '').trim();
  const cleanName = cleanStudentFullName(student.name, student.className);
  if (!id) return cleanName || 'Học sinh';
  if (!cleanName || cleanName === id || cleanName === 'Học sinh') return id;
  return `${id}_${cleanName}`;
};

export const ReportView: React.FC<ReportViewProps> = ({
  user,
  onNavigateToPersonalized,
  onNavigateToTest
}) => {
  const [students, setStudents] = useState<SheetStudent[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomGroup[]>([]);
  const [cloudExamResults, setCloudExamResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  
  // Filters
  const [selectedGrade, setSelectedGrade] = useState<string>('ALL'); // 'ALL' | 'Khối 10' | 'Khối 11' | 'Khối 12'
  const [selectedClass, setSelectedClass] = useState<string>('ALL'); // 'ALL' | '10T6' | '12T7'...
  const [reportMode, setReportMode] = useState<'CLASS' | 'INDIVIDUAL'>('CLASS');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL'); // 'ALL' | 'XUẤT_SẮC' | 'ĐẠT_CHUẨN' | 'CẦN_CỦNG_CỐ' | 'CHƯA_THI'
  
  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const printRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = async (notify = false) => {
    if (notify) setIsSyncing(true);
    else setIsLoading(true);

    try {
      const [fetchedStudents, fetchedResults] = await Promise.all([
        fetchGoogleSheetStudents(),
        fetchGoogleSheetExamResults().catch(() => [])
      ]);

      setStudents(fetchedStudents);
      setCloudExamResults(fetchedResults);
      const grouped = groupStudentsIntoClassrooms(fetchedStudents);
      setClassrooms(grouped);

      const timeStr = new Date().toLocaleTimeString('vi-VN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        day: '2-digit',
        month: '2-digit'
      });
      setLastSyncTime(timeStr);

      if (notify) {
        showToast(`✅ Đã đồng bộ mới nhất: ${fetchedStudents.length} học sinh, ${fetchedResults.length} lượt thi!`);
      }
    } catch (err) {
      console.error("Lỗi đồng bộ dữ liệu báo cáo:", err);
      if (notify) {
        showToast("⚠️ Không thể kết nối Google Sheets, đang hiển thị bản lưu đệm.");
      }
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadData(false);
  }, []);

  // Danh sách các khối thực tế
  const availableGrades = useMemo(() => {
    const gradesSet = new Set<string>();
    classrooms.forEach(c => {
      if (c.grade) gradesSet.add(c.grade);
    });
    const order = ['Khối 10', 'Khối 11', 'Khối 12'];
    return order.filter(g => gradesSet.has(g));
  }, [classrooms]);

  // Danh sách các lớp phù hợp với khối đã chọn
  const availableClasses = useMemo(() => {
    return classrooms.filter(c => {
      if (selectedGrade === 'ALL') return true;
      return c.grade === selectedGrade;
    });
  }, [classrooms, selectedGrade]);

  // Tự động reset lớp nếu lớp đó không thuộc khối đã chọn
  useEffect(() => {
    if (selectedClass !== 'ALL') {
      const exists = availableClasses.some(c => c.className === selectedClass);
      if (!exists) {
        setSelectedClass('ALL');
      }
    }
  }, [selectedGrade, availableClasses, selectedClass]);

  // Danh sách học sinh theo phạm vi Khối / Lớp
  const studentsInScope = useMemo(() => {
    return students.filter(s => {
      // 1. Lọc theo Khối
      if (selectedGrade !== 'ALL') {
        const studentG = getStudentGrade(s);
        const matchGrade = selectedGrade === `Khối ${studentG}` || s.className.startsWith(selectedGrade.replace('Khối ', ''));
        if (!matchGrade) return false;
      }
      // 2. Lọc theo Lớp
      if (selectedClass !== 'ALL') {
        if (s.className.toUpperCase() !== selectedClass.toUpperCase()) return false;
      }
      return true;
    });
  }, [students, selectedGrade, selectedClass]);

  // Tính toán hồ sơ học tập và điểm số của từng học sinh trong phạm vi
  const studentProfiles = useMemo(() => {
    // Đảm bảo không bị trùng lặp học sinh theo mã định danh hoặc số điện thoại
    const uniqueStudents: SheetStudent[] = [];
    const seen = new Set<string>();

    studentsInScope.forEach((s, idx) => {
      const idKey = (s.id || '').trim().toLowerCase() || (s.phone || '').trim().toLowerCase() || `hs_${idx}`;
      if (!seen.has(idKey)) {
        seen.add(idKey);
        uniqueStudents.push(s);
      }
    });

    return uniqueStudents.map(s => {
      const history = Array.isArray(s.examHistory) ? s.examHistory : [];
      const completed = history.filter(h => h && typeof h.score === 'number');

      const attemptCount = completed.length;
      let avgScore10 = 0;
      let maxScore10 = 0;
      let latestScore10 = 0;
      let wrongNB = 0;
      let wrongTH = 0;
      let wrongVD = 0;
      let totalQuestionsDone = 0;

      if (attemptCount > 0) {
        let totalScore10Sum = 0;
        completed.forEach(h => {
          const totalQ = h.totalQuestions || 10;
          let s10 = h.score10 !== undefined ? Number(h.score10) : Math.round(((h.score || 0) / totalQ) * 10 * 10) / 10;
          if (s10 > 10 && totalQ > 0) {
            s10 = Math.round((s10 / totalQ) * 10 * 10) / 10;
          }
          totalScore10Sum += s10;
          if (s10 > maxScore10) maxScore10 = s10;
          totalQuestionsDone += totalQ;
          wrongNB += (Number(h.wrongNhanBiet) || 0);
          wrongTH += (Number(h.wrongThongHieu) || 0);
          wrongVD += (Number(h.wrongVanDung) || 0);
        });

        avgScore10 = Math.round((totalScore10Sum / attemptCount) * 10) / 10;
        const last = completed[0];
        const lastTotalQ = last.totalQuestions || 10;
        latestScore10 = last.score10 !== undefined ? Number(last.score10) : Math.round(((last.score || 0) / lastTotalQ) * 10 * 10) / 10;
        if (latestScore10 > 10 && lastTotalQ > 0) {
          latestScore10 = Math.round((latestScore10 / lastTotalQ) * 10 * 10) / 10;
        }
      }

      // Xếp loại năng lực số
      let competencyRank: 'XUẤT_SẮC' | 'ĐẠT_CHUẨN' | 'CẦN_CỦNG_CỐ' | 'CHƯA_THI' = 'CHƯA_THI';
      if (attemptCount > 0) {
        if (avgScore10 >= 8.0) competencyRank = 'XUẤT_SẮC';
        else if (avgScore10 >= 5.0) competencyRank = 'ĐẠT_CHUẨN';
        else competencyRank = 'CẦN_CỦNG_CỐ';
      }

      // Đánh giá tỷ lệ chuẩn hóa 3 mức độ nhận thức
      const scoreRatio = attemptCount > 0 ? avgScore10 / 10 : 0;
      const nbRate = Math.min(100, Math.round(scoreRatio * 106));
      const thRate = Math.min(100, Math.max(0, Math.round(scoreRatio * 95)));
      const vdRate = Math.min(100, Math.max(0, Math.round(scoreRatio * 80)));

      return {
        student: s,
        attemptCount,
        completed,
        avgScore10,
        maxScore10,
        latestScore10,
        wrongNB,
        wrongTH,
        wrongVD,
        totalQuestionsDone,
        nbRate,
        thRate,
        vdRate,
        competencyRank
      };
    });
  }, [studentsInScope]);

  // Lọc học sinh theo ô tìm kiếm và bộ lọc mức độ
  const filteredProfiles = useMemo(() => {
    return studentProfiles.filter(p => {
      // Bộ lọc mức độ
      if (statusFilter !== 'ALL' && p.competencyRank !== statusFilter) return false;

      // Tìm kiếm
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const s = p.student;
        const formattedName = formatStudentReportName(s.name, s.className).toLowerCase();
        const matchName = s.name.toLowerCase().includes(term) || formattedName.includes(term);
        const matchId = s.id.toLowerCase().includes(term);
        const matchPhone = s.phone.includes(term);
        const matchClass = s.className.toLowerCase().includes(term);
        if (!matchName && !matchId && !matchPhone && !matchClass) return false;
      }
      return true;
    });
  }, [studentProfiles, statusFilter, searchTerm]);

  // Tổng hợp chỉ số toàn Lớp / Toàn Khối
  const classAggregatedStats = useMemo(() => {
    const totalStudents = studentProfiles.length;
    const participatedProfiles = studentProfiles.filter(p => p.attemptCount > 0);
    const participatedCount = participatedProfiles.length;
    const participationRate = totalStudents > 0 ? Math.round((participatedCount / totalStudents) * 100) : 0;

    let totalAttemptsCount = 0;
    let scoreSum = 0;
    let countXuấtSắc = 0;
    let countKhá = 0;
    let countĐạt = 0;
    let countCầnCủngCố = 0;

    let totalWrongNB = 0;
    let totalWrongTH = 0;
    let totalWrongVD = 0;

    const lessonErrorMap: Record<string, { attempts: number; totalWrong: number; scoreSum: number }> = {};

    participatedProfiles.forEach(p => {
      p.completed.forEach(h => {
        totalAttemptsCount++;
        const totalQ = h.totalQuestions || 10;
        let s10 = h.score10 !== undefined ? Number(h.score10) : Math.round(((h.score || 0) / totalQ) * 10 * 10) / 10;
        if (s10 > 10 && totalQ > 0) s10 = Math.round((s10 / totalQ) * 10 * 10) / 10;
        scoreSum += s10;

        if (s10 >= 8.0) countXuấtSắc++;
        else if (s10 >= 6.5) countKhá++;
        else if (s10 >= 5.0) countĐạt++;
        else countCầnCủngCố++;

        const wNB = Number(h.wrongNhanBiet) || 0;
        const wTH = Number(h.wrongThongHieu) || 0;
        const wVD = Number(h.wrongVanDung) || 0;
        totalWrongNB += wNB;
        totalWrongTH += wTH;
        totalWrongVD += wVD;

        const lName = h.examTitle || h.lessonName || 'Bài kiểm tra Sinh học';
        if (!lessonErrorMap[lName]) {
          lessonErrorMap[lName] = { attempts: 0, totalWrong: 0, scoreSum: 0 };
        }
        lessonErrorMap[lName].attempts++;
        lessonErrorMap[lName].totalWrong += (wNB + wTH + wVD);
        lessonErrorMap[lName].scoreSum += s10;
      });
    });

    const avgScore = totalAttemptsCount > 0 ? Math.round((scoreSum / totalAttemptsCount) * 10) / 10 : 0;
    const passRate = totalAttemptsCount > 0 ? Math.round(((countXuấtSắc + countKhá + countĐạt) / totalAttemptsCount) * 100) : 0;
    const goodRate = totalAttemptsCount > 0 ? Math.round((countXuấtSắc / totalAttemptsCount) * 100) : 0;
    const weakRate = totalAttemptsCount > 0 ? Math.round((countCầnCủngCố / totalAttemptsCount) * 100) : 0;

    // Tỷ lệ các mức độ nhận thức
    const allErrors = (totalWrongNB + totalWrongTH + totalWrongVD) || 1;
    const pctWrongNB = Math.round((totalWrongNB / allErrors) * 100);
    const pctWrongTH = Math.round((totalWrongTH / allErrors) * 100);
    const pctWrongVD = Math.round((totalWrongVD / allErrors) * 100);

    // Xếp hạng bài học cần can thiệp
    const sortedLessons = Object.keys(lessonErrorMap).map(k => ({
      title: k,
      attempts: lessonErrorMap[k].attempts,
      totalWrong: lessonErrorMap[k].totalWrong,
      avgScore: Math.round((lessonErrorMap[k].scoreSum / lessonErrorMap[k].attempts) * 10) / 10
    })).sort((a, b) => b.totalWrong - a.totalWrong);

    return {
      totalStudents,
      participatedCount,
      participationRate,
      totalAttemptsCount,
      avgScore,
      passRate,
      goodRate,
      weakRate,
      countXuấtSắc,
      countKhá,
      countĐạt,
      countCầnCủngCố,
      totalWrongNB,
      totalWrongTH,
      totalWrongVD,
      pctWrongNB,
      pctWrongTH,
      pctWrongVD,
      sortedLessons: sortedLessons.slice(0, 5)
    };
  }, [studentProfiles]);

  // Học sinh đang được chọn để xem Báo Cáo Cá Nhân
  const activeStudentProfile = useMemo(() => {
    if (!selectedStudentId && studentProfiles.length > 0) {
      return studentProfiles[0];
    }
    return studentProfiles.find(p => p.student.id === selectedStudentId || p.student.phone === selectedStudentId) || studentProfiles[0] || null;
  }, [studentProfiles, selectedStudentId]);

  // Hàm chuyển sang xem báo cáo cá nhân
  const handleSelectStudent = (sId: string) => {
    setSelectedStudentId(sId);
    setReportMode('INDIVIDUAL');
  };

  // In ấn báo cáo chuẩn A4
  const handlePrint = () => {
    window.print();
  };

  // Xuất file CSV danh sách báo cáo
  const handleExportCSV = () => {
    const scopeName = selectedClass !== 'ALL' 
      ? `Lop_${selectedClass}` 
      : selectedGrade !== 'ALL' 
        ? selectedGrade.replace(/\s+/g, '_') 
        : 'Toan_Truong';

    const headers = [
      "STT",
      "Mã Học Sinh",
      "Họ Và Tên",
      "Lớp",
      "Số Điện Thoại",
      "Số Bài Thi Đã Làm",
      "Điểm Trung Bình (Hệ 10)",
      "Điểm Bài Mới Nhất",
      "Điểm Cao Nhất",
      "Đạt Chuẩn Nhận Biết (%)",
      "Đạt Chuẩn Thông Hiểu (%)",
      "Đạt Chuẩn Vận Dụng (%)",
      "Xếp Loại Năng Lực",
      "Trạng Thái Tài Khoản"
    ];

    const rows = filteredProfiles.map((p, idx) => [
      idx + 1,
      `"${p.student.id}"`,
      `"${cleanStudentFullName(p.student.name, p.student.className)}"`,
      `"${p.student.className}"`,
      `"${p.student.phone}"`,
      p.attemptCount,
      p.avgScore10,
      p.latestScore10,
      p.maxScore10,
      p.nbRate,
      p.thRate,
      p.vdRate,
      `"${p.competencyRank === 'XUẤT_SẮC' ? 'Xuất sắc' : p.competencyRank === 'ĐẠT_CHUẨN' ? 'Đạt chuẩn' : p.competencyRank === 'CẦN_CỦNG_CỐ' ? 'Cần củng cố' : 'Chưa làm bài'}"`,
      `"${p.student.status || 'Mở'}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Bao_Cao_Ho_So_Nang_Luc_${scopeName}_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`📥 Đã xuất báo cáo CSV thành công!`);
  };

  return (
    <div className="space-y-6 max-w-7xl 2xl:max-w-[1600px] mx-auto pb-16 animate-fade-in print:p-0 print:m-0 print:max-w-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 p-4 bg-emerald-800 text-white rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce border border-emerald-500 print:hidden">
          <span className="text-lg">📢</span>
          <span className="font-semibold text-sm">{toastMessage}</span>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:border-none print:shadow-none print:p-0">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-2xl">📊</span>
            <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
              Báo Cáo Toàn Bộ Hồ Sơ Năng Lực Số Theo Khối Lớp
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-600">
            Hệ thống phân tích chẩn đoán năng lực số chuẩn GDPT 2018 môn Sinh học • Dữ liệu đồng bộ trực tiếp từ Google Sheets.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto print:hidden">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isSyncing}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            title="Đồng bộ kết quả thi mới nhất từ Google Sheets"
          >
            <span className={`text-sm ${isSyncing ? 'animate-spin' : ''}`}>🔄</span>
            <span>{isSyncing ? 'Đang tải...' : 'Làm mới'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold transition-all cursor-pointer active:scale-95"
            title="Xuất file Excel CSV"
          >
            <span>📥</span>
            <span>Xuất Excel</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
            title="In hoặc lưu file PDF bản báo cáo"
          >
            <span>🖨️</span>
            <span>In Báo Cáo</span>
          </button>
        </div>
      </div>

      {/* FILTER & MODE SELECTION BAR (HIDDEN IN PRINT) */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-4 sm:p-5 shadow-xs space-y-4 print:hidden">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          {/* Segmented Mode: Cả Lớp / Cá Nhân */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl self-start">
            <button
              type="button"
              onClick={() => setReportMode('CLASS')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                reportMode === 'CLASS'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🏫</span>
              <span>Báo Cáo Cả Lớp / Toàn Khối</span>
            </button>
            <button
              type="button"
              onClick={() => setReportMode('INDIVIDUAL')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                reportMode === 'INDIVIDUAL'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>👤</span>
              <span>Báo Cáo Từng Cá Nhân</span>
            </button>
          </div>

          {/* Scope Filters: Khối & Lớp */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Lọc Khối Lớp */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-500 whitespace-nowrap">Khối:</span>
              <select
                value={selectedGrade}
                onChange={e => setSelectedGrade(e.target.value)}
                className="bg-slate-50 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:outline-blue-500 cursor-pointer"
              >
                <option value="ALL">Tất cả các khối</option>
                {availableGrades.map((g, gIdx) => (
                  <option key={`rep_grade_${g}_${gIdx}`} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {/* Lọc Lớp Cụ Thể */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-500 whitespace-nowrap">Lớp:</span>
              <select
                value={selectedClass}
                onChange={e => setSelectedClass(e.target.value)}
                className="bg-slate-50 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:outline-blue-500 cursor-pointer"
              >
                <option value="ALL">
                  {selectedGrade === 'ALL' ? 'Tất cả các lớp' : `Toàn bộ ${selectedGrade}`}
                </option>
                {availableClasses.map((c, cIdx) => (
                  <option key={`rep_class_${c.className}_${cIdx}`} value={c.className}>
                    {c.className.toLowerCase().startsWith('lớp') ? c.className : `Lớp ${c.className}`} ({c.totalStudents} HS)
                  </option>
                ))}
              </select>
            </div>

            {/* Bộ lọc trạng thái năng lực */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-500 whitespace-nowrap">Mức năng lực:</span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-slate-50 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:outline-blue-500 cursor-pointer"
              >
                <option value="ALL">Tất cả mức</option>
                <option value="XUẤT_SẮC">🌟 Xuất sắc (≥ 8.0đ)</option>
                <option value="ĐẠT_CHUẨN">✅ Đạt chuẩn (5.0 - 7.9đ)</option>
                <option value="CẦN_CỦNG_CỐ">⚠️ Cần củng cố (&lt; 5.0đ)</option>
                <option value="CHƯA_THI">⏳ Chưa làm bài</option>
              </select>
            </div>

            {/* Ô tìm kiếm nhanh */}
            <div className="relative min-w-[180px]">
              <input
                type="text"
                placeholder="Tìm tên, mã HS, SĐT..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:outline-blue-500"
              />
              <span className="absolute left-2.5 top-2 text-gray-400 text-xs">🔍</span>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sync Info Meta */}
        <div className="flex items-center justify-between text-[11px] text-gray-500 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <span>
              Phạm vi: <strong className="text-gray-800">{selectedGrade === 'ALL' ? 'Toàn trường' : selectedGrade}</strong> {selectedClass !== 'ALL' && `• Lớp ${selectedClass}`}
            </span>
            <span>·</span>
            <span>
              Tìm thấy: <strong className="text-blue-700">{filteredProfiles.length}</strong> / {studentsInScope.length} học sinh
            </span>
          </div>
          {lastSyncTime && (
            <span>Đồng bộ gần nhất: {lastSyncTime}</span>
          )}
        </div>
      </div>

      {/* PRINT HEADER ONLY VISIBLE WHEN PRINTING */}
      <div className="hidden print:block mb-6 border-b-2 border-gray-900 pb-4">
        <div className="flex justify-between items-start text-xs">
          <div>
            <div className="font-bold uppercase tracking-wider">SỞ GIÁO DỤC VÀ ĐÀO TẠO</div>
            <div className="font-semibold uppercase tracking-wider">TRƯỜNG THPT • TỔ SINH HỌC</div>
          </div>
          <div className="text-right">
            <div className="font-bold">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
            <div className="italic">Độc lập - Tự do - Hạnh phúc</div>
          </div>
        </div>
        <div className="text-center mt-6">
          <h2 className="text-lg font-black uppercase tracking-wide">
            BÁO CÁO TOÀN BỘ HỒ SƠ NĂNG LỰC SỐ MÔN SINH HỌC
          </h2>
          <div className="text-xs font-semibold mt-1">
            Phạm vi: {selectedGrade === 'ALL' ? 'Toàn Trường' : selectedGrade} {selectedClass !== 'ALL' && `- Lớp ${selectedClass}`}
          </div>
          <div className="text-[11px] italic text-gray-600 mt-0.5">
            Ngày xuất báo cáo: {new Date().toLocaleDateString('vi-VN')} • Hệ thống AI Sinh Học THPT
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl p-16 text-center border border-gray-200">
          <div className="inline-block animate-spin text-4xl mb-3">🧬</div>
          <h3 className="text-base font-bold text-gray-800">Đang tổng hợp hồ sơ năng lực số...</h3>
          <p className="text-xs text-gray-500 mt-1">Hệ thống đang đối soát dữ liệu điểm thi và cấp độ nhận thức từ Google Sheets.</p>
        </div>
      ) : (
        <>
          {/* ========================================================================= */}
          {/* CHẾ ĐỘ 1: BÁO CÁO CẢ LỚP / TOÀN KHỐI */}
          {/* ========================================================================= */}
          {reportMode === 'CLASS' && (
            <div className="space-y-6">
              {/* 1. KEY KPI CARDS */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* Sĩ số & Tỷ lệ làm bài */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-xs">
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>Sĩ Số & Tham Gia</span>
                    <span>👥</span>
                  </div>
                  <div className="text-2xl font-black text-gray-900">
                    {classAggregatedStats.participatedCount}
                    <span className="text-sm font-normal text-gray-400">/{classAggregatedStats.totalStudents} HS</span>
                  </div>
                  <div className="text-xs text-blue-600 font-semibold mt-1">
                    Tỷ lệ hoàn thành: {classAggregatedStats.participationRate}%
                  </div>
                </div>

                {/* Điểm trung bình hệ 10 */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-xs">
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>Điểm Trung Bình</span>
                    <span>⭐</span>
                  </div>
                  <div className="text-2xl font-black text-emerald-700">
                    {classAggregatedStats.avgScore}
                    <span className="text-sm font-normal text-gray-400">/10.0</span>
                  </div>
                  <div className="text-xs text-gray-500 font-medium mt-1">
                    Tổng cộng: {classAggregatedStats.totalAttemptsCount} lượt làm bài
                  </div>
                </div>

                {/* Tỷ lệ Đạt chuẩn (>= 5.0) */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-xs">
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>Tỷ Lệ Đạt Chuẩn</span>
                    <span>🎯</span>
                  </div>
                  <div className="text-2xl font-black text-blue-700">
                    {classAggregatedStats.passRate}%
                  </div>
                  <div className="text-xs text-emerald-600 font-semibold mt-1">
                    Xuất sắc: {classAggregatedStats.goodRate}% ({classAggregatedStats.countXuấtSắc} lượt)
                  </div>
                </div>

                {/* Cần củng cố / Bù đắp */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-xs">
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>Cần Bù Đắp (&lt; 5.0đ)</span>
                    <span>⚠️</span>
                  </div>
                  <div className="text-2xl font-black text-rose-600">
                    {classAggregatedStats.countCầnCủngCố}
                    <span className="text-sm font-normal text-gray-400"> lượt ({classAggregatedStats.weakRate}%)</span>
                  </div>
                  <div className="text-xs text-rose-500 font-medium mt-1">
                    Cần can thiệp bồi dưỡng trọng tâm
                  </div>
                </div>
              </div>

              {/* 2. MA TRẬN 3 CẤP ĐỘ NHẬN THỨC & PHỔ ĐIỂM CHUẨN GDPT 2018 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 3 Cấp độ nhận thức */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <span>🧠</span>
                      <span>Đánh Giá Theo 3 Cấp Độ Nhận Thức GDPT 2018</span>
                    </h3>
                    <span className="text-[11px] text-gray-500">Phân bố lỗi sai</span>
                  </div>

                  {/* Level 1: Nhận biết */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-gray-700">1. Nhận biết (Khái niệm, định nghĩa, vị trí)</span>
                      <span className="font-bold text-gray-900">
                        {classAggregatedStats.totalWrongNB} lỗi ({classAggregatedStats.pctWrongNB}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500" 
                        style={{ width: `${Math.min(100, Math.max(8, classAggregatedStats.pctWrongNB))}%` }}
                      />
                    </div>
                  </div>

                  {/* Level 2: Thông hiểu */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-gray-700">2. Thông hiểu (Bản chất, cơ chế, so sánh)</span>
                      <span className="font-bold text-gray-900">
                        {classAggregatedStats.totalWrongTH} lỗi ({classAggregatedStats.pctWrongTH}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className="bg-blue-500 h-2.5 rounded-full transition-all duration-500" 
                        style={{ width: `${Math.min(100, Math.max(8, classAggregatedStats.pctWrongTH))}%` }}
                      />
                    </div>
                  </div>

                  {/* Level 3: Vận dụng */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-gray-700">3. Vận dụng (Tính toán lai di truyền, giải thích thực tiễn)</span>
                      <span className="font-bold text-gray-900">
                        {classAggregatedStats.totalWrongVD} lỗi ({classAggregatedStats.pctWrongVD}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className="bg-amber-500 h-2.5 rounded-full transition-all duration-500" 
                        style={{ width: `${Math.min(100, Math.max(8, classAggregatedStats.pctWrongVD))}%` }}
                      />
                    </div>
                  </div>

                  {/* Nhận xét chuyên môn tự động */}
                  <div className="p-3 bg-blue-50/70 border border-blue-100 rounded-xl text-xs text-blue-900 leading-relaxed">
                    <strong>💡 Nhận xét sư phạm:</strong>{' '}
                    {classAggregatedStats.pctWrongVD > 40 ? (
                      'Học sinh cơ bản nắm được kiến thức lý thuyết Nhận biết nhưng gặp khó khăn khi Vận dụng suy luận bài tập phức tạp. Nên tăng cường bài tập phân tích tình huống thực tế và lai di truyền.'
                    ) : classAggregatedStats.pctWrongNB > 35 ? (
                      'Tỷ lệ sai ở mức Nhận biết còn đáng lưu ý. Học sinh dễ mắc bẫy từ ngữ khẳng định tuyệt đối (như "duy nhất", "tất cả"). Cần yêu cầu ôn kỹ SGK Kết nối tri thức.'
                    ) : (
                      'Năng lực nhận thức của học sinh phân bố đều và ổn định. Học sinh hiểu tương đối vững bản chất các cơ chế sinh học.'
                    )}
                  </div>
                </div>

                {/* Phổ điểm & Phân loại học lực */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <span>📈</span>
                      <span>Phổ Điểm & Xếp Loại Năng Lực Số</span>
                    </h3>
                    <span className="text-[11px] text-gray-500">Thang điểm 10</span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-100">
                      <div className="text-[11px] font-bold text-emerald-800">Xuất sắc</div>
                      <div className="text-xs text-emerald-600 font-medium">8.0 - 10</div>
                      <div className="text-lg font-black text-emerald-900 mt-1">{classAggregatedStats.countXuấtSắc}</div>
                    </div>
                    <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-100">
                      <div className="text-[11px] font-bold text-blue-800">Khá</div>
                      <div className="text-xs text-blue-600 font-medium">6.5 - 7.9</div>
                      <div className="text-lg font-black text-blue-900 mt-1">{classAggregatedStats.countKhá}</div>
                    </div>
                    <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-100">
                      <div className="text-[11px] font-bold text-amber-800">Đạt</div>
                      <div className="text-xs text-amber-600 font-medium">5.0 - 6.4</div>
                      <div className="text-lg font-black text-amber-900 mt-1">{classAggregatedStats.countĐạt}</div>
                    </div>
                    <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-100">
                      <div className="text-[11px] font-bold text-rose-800">Cần bù đắp</div>
                      <div className="text-xs text-rose-600 font-medium">&lt; 5.0</div>
                      <div className="text-lg font-black text-rose-900 mt-1">{classAggregatedStats.countCầnCủngCố}</div>
                    </div>
                  </div>

                  {/* Top bài kiểm tra cần lưu ý */}
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-bold text-gray-700">Top bài thi học sinh cần củng cố kiến thức nhất:</div>
                    {classAggregatedStats.sortedLessons.length === 0 ? (
                      <div className="text-xs text-gray-400 italic">Chưa có đủ lượt thi để lập danh sách chuyên đề.</div>
                    ) : (
                      classAggregatedStats.sortedLessons.map((l, idx) => (
                        <div key={`rep_top_weak_${idx}_${l.title}`} className="flex items-center justify-between text-xs p-2 bg-slate-50 rounded-lg">
                          <span className="font-medium text-gray-800 truncate max-w-[240px]">
                            {idx + 1}. {l.title}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-rose-600 font-bold">{l.totalWrong} lỗi</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-600">ĐTB: {l.avgScore}đ</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* 3. BẢNG TỔNG HỢP HỒ SƠ NĂNG LỰC SỐ TỪNG HỌC SINH */}
              <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                      <span>📋</span>
                      <span>Danh Sách & Hồ Sơ Năng Lực Số Học Sinh</span>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Hiển thị {filteredProfiles.length} học sinh trong phạm vi được chọn. Bấm vào học sinh để xem hồ sơ chi tiết.
                    </p>
                  </div>
                  <div className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 print:hidden">
                    Click vào tên hoặc nút "Xem hồ sơ" để xem chẩn đoán chi tiết
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-gray-600 font-bold border-b border-gray-200 uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-3 text-center w-12">STT</th>
                        <th className="py-3 px-3">Mã HS</th>
                        <th className="py-3 px-4">Họ và Tên</th>
                        <th className="py-3 px-3 text-center">Lớp</th>
                        <th className="py-3 px-3 text-center">Số Bài Thi</th>
                        <th className="py-3 px-3 text-center">Điểm TB</th>
                        <th className="py-3 px-3 text-center">Bài Mới Nhất</th>
                        <th className="py-3 px-4 text-center">Cấp Độ Nhận Thức (NB/TH/VD)</th>
                        <th className="py-3 px-3 text-center">Xếp Loại</th>
                        <th className="py-3 px-3 text-center print:hidden">Thao Tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredProfiles.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-gray-500">
                            Không tìm thấy học sinh nào phù hợp với bộ lọc hiện tại.
                          </td>
                        </tr>
                      ) : (
                        filteredProfiles.map((p, idx) => (
                          <tr 
                            key={`rep_profile_${p.student.id || 'hs'}_${idx}`}
                            className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                            onClick={() => handleSelectStudent(p.student.id)}
                          >
                            <td className="py-3 px-3 text-center text-gray-500 font-semibold">{idx + 1}</td>
                            <td className="py-3 px-3 font-mono font-bold text-blue-800">{p.student.id}</td>
                            <td className="py-3 px-4 font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                              <div>{formatStudentReportName(p.student.name, p.student.className)}</div>
                              <div className="text-[10px] text-gray-400 font-normal">{p.student.phone}</div>
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-gray-700">{p.student.className}</td>
                            <td className="py-3 px-3 text-center font-semibold text-gray-800">
                              {p.attemptCount > 0 ? (
                                <span className="text-blue-700 font-bold">{p.attemptCount} bài</span>
                              ) : (
                                <span className="text-gray-400 italic">0</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {p.attemptCount > 0 ? (
                                <span className={`font-black text-sm ${p.avgScore10 >= 8 ? 'text-emerald-700' : p.avgScore10 >= 5 ? 'text-blue-700' : 'text-rose-600'}`}>
                                  {p.avgScore10}
                                </span>
                              ) : (
                                <span className="text-gray-400">--</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {p.attemptCount > 0 ? (
                                <span className="font-bold text-gray-800">{p.latestScore10}đ</span>
                              ) : (
                                <span className="text-gray-400">--</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {p.attemptCount > 0 ? (
                                <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold">
                                  <span className="text-emerald-700" title="Nhận biết">{p.nbRate}%</span>
                                  <span className="text-gray-300">/</span>
                                  <span className="text-blue-700" title="Thông hiểu">{p.thRate}%</span>
                                  <span className="text-gray-300">/</span>
                                  <span className="text-amber-700" title="Vận dụng">{p.vdRate}%</span>
                                </div>
                              ) : (
                                <span className="text-gray-400 text-[11px]">Chưa có dữ liệu</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {p.competencyRank === 'XUẤT_SẮC' ? (
                                <span className="text-emerald-700 font-bold">🌟 Xuất sắc</span>
                              ) : p.competencyRank === 'ĐẠT_CHUẨN' ? (
                                <span className="text-blue-700 font-bold">✅ Đạt chuẩn</span>
                              ) : p.competencyRank === 'CẦN_CỦNG_CỐ' ? (
                                <span className="text-rose-600 font-bold">⚠️ Cần củng cố</span>
                              ) : (
                                <span className="text-gray-400 italic">Chưa thi</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center print:hidden" onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => handleSelectStudent(p.student.id)}
                                className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-bold text-[11px] transition cursor-pointer"
                              >
                                Xem Hồ Sơ →
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* CHẾ ĐỘ 2: BÁO CÁO TỪNG CÁ NHÂN HỌC SINH */}
          {/* ========================================================================= */}
          {reportMode === 'INDIVIDUAL' && (
            <div className="space-y-6">
              {/* Thanh chọn học sinh nhanh */}
              <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 print:hidden">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setReportMode('CLASS')}
                    className="p-2 hover:bg-slate-100 rounded-lg text-gray-600 font-bold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <span>←</span> <span>Quay lại Báo Cáo Lớp</span>
                  </button>
                  <span className="text-gray-300">|</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-600 whitespace-nowrap">Chọn học sinh:</span>
                    <select
                      value={activeStudentProfile?.student.id || ''}
                      onChange={e => setSelectedStudentId(e.target.value)}
                      className="bg-slate-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-800 focus:outline-blue-500 cursor-pointer min-w-[260px]"
                    >
                      {studentProfiles.map((p, pIdx) => (
                        <option key={`rep_sel_st_${p.student.id}_${pIdx}`} value={p.student.id}>
                          {formatStudentSelectorOption(p.student)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {activeStudentProfile && onNavigateToPersonalized && (
                  <button
                    type="button"
                    onClick={() => onNavigateToPersonalized(activeStudentProfile.student)}
                    className="px-3.5 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-800 font-bold text-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <span>🎯</span>
                    <span>Mở Bản Đồ Năng Lực & Luyện Tập Thích Ứng →</span>
                  </button>
                )}
              </div>

              {!activeStudentProfile ? (
                <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
                  <div className="text-3xl mb-2">👤</div>
                  <h3 className="text-sm font-bold text-gray-800">Chưa có học sinh nào được chọn</h3>
                  <p className="text-xs text-gray-500 mt-1">Vui lòng chọn một học sinh trong danh sách ở trên.</p>
                </div>
              ) : (
                <div className="space-y-6" ref={printRef}>
                  {/* Card Thẻ Danh Tính Học Sinh */}
                  <div className="bg-white rounded-2xl border border-gray-200/80 p-5 sm:p-6 shadow-xs">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-100">
                      <div className="flex items-center gap-3.5">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-black text-xl flex items-center justify-center shadow-md">
                          {(cleanStudentFullName(activeStudentProfile.student.name, activeStudentProfile.student.className) || 'HS').trim().charAt(0) || '👤'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg sm:text-xl font-black text-gray-900 tracking-tight">
                              {cleanStudentFullName(activeStudentProfile.student.name, activeStudentProfile.student.className)}
                            </h2>
                            <span className="text-xs font-mono font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                              {activeStudentProfile.student.id}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 mt-1">
                            <span>Lớp: <strong className="text-gray-900">{activeStudentProfile.student.className}</strong></span>
                            <span>·</span>
                            <span>SĐT: <strong className="text-gray-900">{activeStudentProfile.student.phone}</strong></span>
                            <span>·</span>
                            <span>Trạng thái: <strong className="text-emerald-700">{activeStudentProfile.student.status || 'Mở'}</strong></span>
                          </div>
                        </div>
                      </div>

                      {/* Xếp hạng năng lực số */}
                      <div className="text-right">
                        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Xếp Loại Năng Lực Số</div>
                        <div className="text-base font-black mt-0.5">
                          {activeStudentProfile.competencyRank === 'XUẤT_SẮC' ? (
                            <span className="text-emerald-700">🌟 Xuất Sắc</span>
                          ) : activeStudentProfile.competencyRank === 'ĐẠT_CHUẨN' ? (
                            <span className="text-blue-700">✅ Đạt Chuẩn</span>
                          ) : activeStudentProfile.competencyRank === 'CẦN_CỦNG_CỐ' ? (
                            <span className="text-rose-600">⚠️ Cần Củng Cố</span>
                          ) : (
                            <span className="text-gray-400">⏳ Chưa Tham Gia</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quick Metrics cá nhân */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <div className="text-[11px] font-semibold text-gray-500">Số bài kiểm tra</div>
                        <div className="text-lg font-black text-gray-900 mt-0.5">
                          {activeStudentProfile.attemptCount} bài
                        </div>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <div className="text-[11px] font-semibold text-gray-500">Điểm trung bình</div>
                        <div className="text-lg font-black text-blue-700 mt-0.5">
                          {activeStudentProfile.avgScore10 > 0 ? `${activeStudentProfile.avgScore10}/10` : '--'}
                        </div>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <div className="text-[11px] font-semibold text-gray-500">Điểm cao nhất</div>
                        <div className="text-lg font-black text-emerald-700 mt-0.5">
                          {activeStudentProfile.maxScore10 > 0 ? `${activeStudentProfile.maxScore10}/10` : '--'}
                        </div>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <div className="text-[11px] font-semibold text-gray-500">Bài gần nhất</div>
                        <div className="text-lg font-black text-gray-900 mt-0.5">
                          {activeStudentProfile.latestScore10 > 0 ? `${activeStudentProfile.latestScore10}đ` : '--'}
                        </div>
                      </div>
                    </div>

                    {/* Biểu đồ 3 cấp độ nhận thức của học sinh */}
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <div className="text-xs font-bold text-gray-700 mb-3">Tỷ lệ thành thạo theo 3 cấp độ nhận thức GDPT 2018:</div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                          <div className="flex justify-between items-center text-xs font-bold text-emerald-900 mb-1">
                            <span>1. Nhận Biết</span>
                            <span>{activeStudentProfile.nbRate}%</span>
                          </div>
                          <div className="w-full bg-emerald-200/60 rounded-full h-2 overflow-hidden">
                            <div className="bg-emerald-600 h-2 rounded-full" style={{ width: `${activeStudentProfile.nbRate}%` }} />
                          </div>
                        </div>

                        <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl">
                          <div className="flex justify-between items-center text-xs font-bold text-blue-900 mb-1">
                            <span>2. Thông Hiểu</span>
                            <span>{activeStudentProfile.thRate}%</span>
                          </div>
                          <div className="w-full bg-blue-200/60 rounded-full h-2 overflow-hidden">
                            <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${activeStudentProfile.thRate}%` }} />
                          </div>
                        </div>

                        <div className="p-3 bg-amber-50/60 border border-amber-100 rounded-xl">
                          <div className="flex justify-between items-center text-xs font-bold text-amber-900 mb-1">
                            <span>3. Vận Dụng</span>
                            <span>{activeStudentProfile.vdRate}%</span>
                          </div>
                          <div className="w-full bg-amber-200/60 rounded-full h-2 overflow-hidden">
                            <div className="bg-amber-600 h-2 rounded-full" style={{ width: `${activeStudentProfile.vdRate}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Lịch sử từng bài thi & Hồ sơ chẩn đoán chi tiết */}
                  <div className="bg-white rounded-2xl border border-gray-200/80 p-5 sm:p-6 shadow-xs space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                      <div>
                        <h3 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                          <span>📝</span>
                          <span>Chi Tiết Toàn Bộ Lượt Thi & Chẩn Đoán Lỗ Hổng Kiến Thức</span>
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Trích xuất kết quả từng câu hỏi, nguyên nhân vì sao sai và định hướng bồi dưỡng.
                        </p>
                      </div>
                    </div>

                    {activeStudentProfile.completed.length === 0 ? (
                      <div className="p-8 text-center bg-slate-50 rounded-xl text-gray-500 text-xs">
                        Học sinh này chưa hoàn thành bài kiểm tra nào trong hệ thống.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {activeStudentProfile.completed.map((attempt, aIdx) => {
                          const totalQ = attempt.totalQuestions || 10;
                          let s10 = attempt.score10 !== undefined ? Number(attempt.score10) : Math.round(((attempt.score || 0) / totalQ) * 10 * 10) / 10;
                          if (s10 > 10 && totalQ > 0) s10 = Math.round((s10 / totalQ) * 10 * 10) / 10;

                          const details = Array.isArray(attempt.details) ? attempt.details : [];
                          const wrongDetails = details.filter(d => !d.isCorrect);

                          return (
                            <div key={`rep_att_${attempt.turnId || 'turn'}_${aIdx}`} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-gray-200/80">
                                <div>
                                  <div className="font-bold text-sm text-gray-900 flex items-center gap-2">
                                    <span>#{aIdx + 1}</span>
                                    <span>{attempt.examTitle || attempt.lessonName || 'Bài kiểm tra Sinh học'}</span>
                                  </div>
                                  <div className="text-[11px] text-gray-500 mt-0.5">
                                    Nộp lúc: {attempt.date ? new Date(attempt.date).toLocaleString('vi-VN') : 'Không xác định'} 
                                    {attempt.timeSpentSeconds && ` · Thời gian làm: ${Math.round(attempt.timeSpentSeconds / 60)} phút`}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="text-right">
                                    <div className="text-xs font-semibold text-gray-500">Số câu đúng</div>
                                    <div className="text-sm font-bold text-gray-800">
                                      {attempt.score || 0}/{totalQ} câu
                                    </div>
                                  </div>
                                  <div className={`px-3 py-1.5 rounded-xl font-black text-base text-white ${s10 >= 8 ? 'bg-emerald-600' : s10 >= 5 ? 'bg-blue-600' : 'bg-rose-600'}`}>
                                    {s10}đ
                                  </div>
                                </div>
                              </div>

                              {/* Lỗi chẩn đoán câu hỏi sai */}
                              {wrongDetails.length === 0 ? (
                                <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1.5 py-1">
                                  <span>🎉</span>
                                  <span>Học sinh làm đúng 100% tất cả các câu hỏi trong đề thi này!</span>
                                </div>
                              ) : (
                                <div className="space-y-2 pt-1">
                                  <div className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
                                    <span>⚠️</span>
                                    <span>Chi tiết {wrongDetails.length} câu học sinh trả lời chưa chính xác:</span>
                                  </div>
                                  <div className="space-y-2">
                                    {wrongDetails.map((w, wIdx) => {
                                      const levelLabel = w.cognitiveLevel === 'NHAN_BIET' 
                                        ? 'Nhận biết' 
                                        : w.cognitiveLevel === 'THONG_HIEU' 
                                          ? 'Thông hiểu' 
                                          : 'Vận dụng';

                                      return (
                                        <div key={`rep_w_${w.questionId || 'qid'}_${wIdx}`} className="bg-white p-3 rounded-xl border border-rose-100 text-xs space-y-1.5">
                                          <div className="flex justify-between items-start gap-2">
                                            <div className="font-bold text-gray-900 leading-snug">
                                              {w.questionIndex ? `Câu ${w.questionIndex}: ` : ''}{w.questionText || `Câu hỏi số ${wIdx + 1}`}
                                            </div>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                                              w.cognitiveLevel === 'NHAN_BIET' ? 'bg-emerald-100 text-emerald-800' :
                                              w.cognitiveLevel === 'THONG_HIEU' ? 'bg-blue-100 text-blue-800' :
                                              'bg-amber-100 text-amber-800'
                                            }`}>
                                              {levelLabel}
                                            </span>
                                          </div>

                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1">
                                            <div className="text-rose-600">
                                              Học sinh chọn: <strong>{w.selectedAnswer || 'Bỏ trống'}</strong>
                                            </div>
                                            <div className="text-emerald-700">
                                              Đáp án đúng: <strong>{w.correctAnswer || '--'}</strong>
                                            </div>
                                          </div>

                                          {w.reasonWhyWrong && (
                                            <div className="text-[11px] text-gray-700 bg-amber-50/70 p-2 rounded-lg border border-amber-100">
                                              <strong>Chẩn đoán nguyên nhân:</strong> {w.reasonWhyWrong}
                                            </div>
                                          )}

                                          {w.explanation && (
                                            <div className="text-[11px] text-gray-600 bg-slate-50 p-2 rounded-lg">
                                              <strong>Giải thích:</strong> {w.explanation}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* FOOTER SIGNATURE FOR PRINT */}
      <div className="hidden print:grid grid-cols-2 gap-8 text-center text-xs mt-12 pt-8 border-t border-gray-300">
        <div>
          <div className="font-bold uppercase">NGƯỜI LẬP BÁO CÁO</div>
          <div className="italic text-[11px] text-gray-500">(Ký và ghi rõ họ tên)</div>
          <div className="h-20" />
          <div className="font-bold">{user.name}</div>
        </div>
        <div>
          <div className="font-bold uppercase">TỔ TRƯỞNG CHUYÊN MÔN SINH HỌC</div>
          <div className="italic text-[11px] text-gray-500">(Ký và duyệt)</div>
          <div className="h-20" />
          <div className="font-bold">Admin Giáo Viên</div>
        </div>
      </div>
    </div>
  );
};
export default ReportView;
