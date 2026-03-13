export type ReportCardCommentCategory =
  | "extraordinary"
  | "good_better"
  | "average"
  | "below_average"
  | "at_risk";

export type ReportCardCommentFamily = "mathematics" | "languages" | "science" | "general";

export const REPORT_CARD_COMMENT_CATEGORY_OPTIONS: Array<{
  value: ReportCardCommentCategory;
  label: string;
}> = [
  { value: "extraordinary", label: "Extraordinary" },
  { value: "good_better", label: "Good / Better" },
  { value: "average", label: "Average" },
  { value: "below_average", label: "Below Average" },
  { value: "at_risk", label: "Student at Risk" },
];

const COMMENT_LIBRARY: Record<
  ReportCardCommentFamily,
  Record<ReportCardCommentCategory, string[]>
> = {
  mathematics: {
    extraordinary: [
      "Shows exceptional accuracy and solves complex problems with confidence.",
      "Understands core concepts deeply and applies methods independently.",
      "Produces excellent work and explains mathematical reasoning clearly.",
      "Consistently performs at a high level in problem solving and computation.",
      "Demonstrates strong analytical thinking and finishes tasks with precision.",
      "Uses multiple strategies effectively and reaches correct solutions quickly.",
      "Handles advanced questions confidently and checks work carefully.",
      "Shows outstanding command of formulas, operations, and logical steps.",
      "Works with maturity, accuracy, and excellent mathematical discipline.",
      "Excels in both speed and understanding across class assessments.",
    ],
    good_better: [
      "Performs well and usually solves questions with clear working.",
      "Shows good understanding of concepts and is improving steadily.",
      "Works carefully in class and completes most tasks accurately.",
      "Demonstrates solid mathematical thinking with encouraging progress.",
      "Understands main methods well and applies them with growing confidence.",
      "Shows good accuracy and responds positively to correction.",
      "Handles routine problems successfully and is moving toward stronger independence.",
      "Maintains a good standard and continues to improve through practice.",
      "Completes classwork well and shows a reliable grasp of key skills.",
      "Makes good progress and can reach a higher band with regular revision.",
    ],
    average: [
      "Understands basic concepts but needs more confidence in application.",
      "Can solve routine questions yet struggles when problems become unfamiliar.",
      "Shows acceptable progress, though accuracy needs to improve.",
      "Has a fair grasp of methods but should revise steps more carefully.",
      "Performs at a satisfactory level and needs more independent practice.",
      "Can complete guided work but needs support on multi-step questions.",
      "Shows average understanding and should focus on consistency.",
      "Needs to improve checking habits to reduce avoidable mistakes.",
      "Works steadily but should strengthen problem-solving confidence.",
      "Has potential to improve with regular homework and revision.",
    ],
    below_average: [
      "Finds key concepts difficult and needs more guided support.",
      "Makes frequent errors in basic steps and should revise fundamentals.",
      "Needs to improve accuracy, attention, and regular practice.",
      "Shows effort but is still below the expected level in core skills.",
      "Has difficulty applying methods without teacher guidance.",
      "Needs extra help with calculations, working steps, and checking answers.",
      "Should spend more time revising basic concepts and class examples.",
      "Requires closer follow-up to strengthen confidence and understanding.",
      "Often begins correctly but loses marks through incomplete working.",
      "Must improve routine practice to build a stronger foundation.",
    ],
    at_risk: [
      "Is currently at risk academically and needs immediate support in core concepts.",
      "Shows serious difficulty in basic numeracy and requires targeted intervention.",
      "Needs urgent practice and close monitoring to avoid further decline.",
      "Is not yet meeting minimum expectations and needs structured remediation.",
      "Requires consistent one-to-one support to rebuild essential skills.",
      "Has significant gaps in understanding and must revise fundamentals regularly.",
      "Is struggling to complete even basic questions independently.",
      "Needs a focused recovery plan with daily practice and review.",
      "Should receive timely support at home and school to regain confidence.",
      "Progress is a concern at present and needs immediate academic attention.",
    ],
  },
  languages: {
    extraordinary: [
      "Expresses ideas clearly and shows excellent command of language skills.",
      "Reads with insight and writes with maturity, fluency, and accuracy.",
      "Demonstrates rich vocabulary and very strong comprehension skills.",
      "Produces thoughtful work and communicates with confidence and clarity.",
      "Shows outstanding grammar, structure, and written expression.",
      "Responds critically to texts and supports ideas effectively.",
      "Uses language creatively and accurately across class tasks.",
      "Demonstrates excellent speaking, reading, and writing balance.",
      "Shows strong interpretation skills and polished communication.",
      "Maintains an exceptional standard in both understanding and expression.",
    ],
    good_better: [
      "Shows good comprehension and writes with improving clarity.",
      "Uses language well and continues to build confidence in expression.",
      "Reads carefully and communicates ideas in an organized way.",
      "Demonstrates a good standard in vocabulary, grammar, and understanding.",
      "Produces thoughtful responses and is improving steadily.",
      "Shows good progress in both written and verbal communication.",
      "Understands texts well and expresses meaning with confidence.",
      "Works well in language tasks and can improve further with wider reading.",
      "Displays good control of sentence structure and main ideas.",
      "Performs well and is moving toward more polished expression.",
    ],
    average: [
      "Understands the main ideas but needs stronger written detail.",
      "Shows average language development and should read more regularly.",
      "Can communicate simple ideas but needs clearer structure and accuracy.",
      "Performs at an acceptable level, though grammar and expression need work.",
      "Understands basic texts but needs more confidence in written responses.",
      "Shows fair vocabulary use and should expand reading habits.",
      "Can respond to guided questions but needs deeper interpretation.",
      "Needs to improve sentence accuracy and organization of ideas.",
      "Has a working grasp of language skills but should revise regularly.",
      "Can improve steadily through reading practice and careful writing.",
    ],
    below_average: [
      "Needs support in comprehension, vocabulary, and written expression.",
      "Shows limited confidence in reading and writing tasks at present.",
      "Requires more practice in grammar, spelling, and sentence structure.",
      "Finds it difficult to organize ideas clearly in written work.",
      "Needs closer attention to basic language conventions and accuracy.",
      "Should read more frequently to strengthen understanding and vocabulary.",
      "Has difficulty expressing ideas fully and clearly.",
      "Needs more guided practice to improve comprehension and response quality.",
      "Shows effort but remains below the expected level in communication skills.",
      "Must revise classwork carefully and practice written tasks more often.",
    ],
    at_risk: [
      "Is currently at risk and needs urgent support in reading and writing.",
      "Shows significant difficulty in comprehension and written communication.",
      "Needs immediate intervention to improve basic literacy skills.",
      "Struggles to understand texts and express ideas independently.",
      "Requires structured support in grammar, vocabulary, and reading fluency.",
      "Is not meeting expected language outcomes and needs close follow-up.",
      "Should receive focused help to rebuild confidence in literacy tasks.",
      "Needs daily reading and guided writing practice to make safe progress.",
      "Current performance is a concern and requires timely academic support.",
      "Needs targeted intervention both in class and through home practice.",
    ],
  },
  science: {
    extraordinary: [
      "Shows excellent scientific understanding and applies concepts with confidence.",
      "Demonstrates strong observation, reasoning, and practical thinking.",
      "Explains scientific ideas clearly and makes accurate connections.",
      "Performs exceptionally well in both theory and application.",
      "Shows strong curiosity and a mature approach to scientific learning.",
      "Uses evidence well and answers analytical questions confidently.",
      "Demonstrates excellent command of concepts, terminology, and reasoning.",
      "Handles diagrams, processes, and explanations with impressive clarity.",
      "Shows outstanding progress in conceptual and practical understanding.",
      "Maintains a very high standard in scientific thinking and class performance.",
    ],
    good_better: [
      "Shows good understanding of scientific concepts and steady progress.",
      "Works well in class and explains main ideas with growing confidence.",
      "Demonstrates good reasoning and usually applies knowledge correctly.",
      "Has a solid grasp of topics and responds well to feedback.",
      "Shows good progress in both theory and class activities.",
      "Understands key processes well and is developing stronger analysis skills.",
      "Performs well and can improve further through revision and practice.",
      "Shows a dependable standard in concept recall and explanation.",
      "Builds ideas well and is moving toward more detailed scientific responses.",
      "Is progressing positively and can reach an even stronger level with consistency.",
    ],
    average: [
      "Understands basic concepts but needs clearer scientific explanation.",
      "Shows average progress and should revise terms and processes more carefully.",
      "Can recall facts but needs support in application and reasoning.",
      "Performs at a satisfactory level, though deeper understanding is needed.",
      "Needs more confidence when explaining cause, effect, and scientific processes.",
      "Shows fair understanding but should strengthen analytical answers.",
      "Can improve through more careful revision and practice questions.",
      "Needs to focus on precise terminology and concept connections.",
      "Handles straightforward work reasonably well but struggles with detailed responses.",
      "Has potential to improve with regular review of class notes and examples.",
    ],
    below_average: [
      "Needs more support in understanding core concepts and scientific language.",
      "Finds it difficult to explain processes clearly and accurately.",
      "Shows effort but remains below the expected level in science work.",
      "Needs more practice with definitions, diagrams, and application questions.",
      "Should revise basic ideas more consistently to improve confidence.",
      "Has difficulty connecting theory to examples and practical understanding.",
      "Needs guided reinforcement in concept recall and explanation.",
      "Would benefit from more structured revision and regular follow-up.",
      "Makes partial progress but still struggles with key scientific ideas.",
      "Must improve attention to terminology, steps, and accurate explanation.",
    ],
    at_risk: [
      "Is currently at risk and needs immediate support in basic scientific concepts.",
      "Shows significant gaps in understanding and requires targeted intervention.",
      "Needs urgent reinforcement in terminology, processes, and application.",
      "Is not yet meeting minimum expectations in science and needs close monitoring.",
      "Requires structured support to rebuild concept understanding and confidence.",
      "Struggles to explain even basic ideas and needs guided remediation.",
      "Needs frequent review and simple practice tasks to regain progress.",
      "Current performance is a concern and requires prompt academic intervention.",
      "Should receive additional help in class and regular revision at home.",
      "Needs a focused improvement plan to recover missed understanding safely.",
    ],
  },
  general: {
    extraordinary: [
      "Shows outstanding understanding and performs at a very high level.",
      "Demonstrates excellent effort, accuracy, and subject confidence.",
      "Produces impressive work and applies learning independently.",
      "Maintains a consistently excellent standard across class tasks.",
      "Shows mature thinking and strong command of the subject.",
      "Responds with confidence and completes work to a high standard.",
      "Demonstrates excellent progress and dependable subject mastery.",
      "Works independently and consistently delivers strong results.",
      "Shows exceptional focus, engagement, and quality of work.",
      "Performs beyond expectations and sets a strong example in class.",
    ],
    good_better: [
      "Shows good understanding and continues to improve steadily.",
      "Works well and demonstrates encouraging subject progress.",
      "Maintains a good standard and responds positively to feedback.",
      "Shows dependable effort and a solid grasp of the subject.",
      "Performs well and is moving toward stronger independent work.",
      "Shows good classroom engagement and improving accuracy.",
      "Understands key ideas and is building confidence gradually.",
      "Produces good work and can improve further with consistency.",
      "Demonstrates a positive attitude and good learning habits.",
      "Shows steady growth and is capable of reaching a higher level.",
    ],
    average: [
      "Shows average understanding and needs more consistency.",
      "Performs at a satisfactory level but should strengthen revision habits.",
      "Can complete guided work but needs more independent confidence.",
      "Shows fair progress and should focus on accuracy and detail.",
      "Understands basic ideas but needs stronger application.",
      "Works at an acceptable level and can improve with regular practice.",
      "Has a reasonable grasp of the subject but should revise more carefully.",
      "Needs to build confidence and consistency in everyday classwork.",
      "Shows potential but must be more regular in effort and follow-up.",
      "Can progress well with more careful preparation and attention.",
    ],
    below_average: [
      "Needs more support to meet the expected standard in this subject.",
      "Shows effort but remains below average in current performance.",
      "Requires more regular practice and closer follow-up.",
      "Needs to improve understanding, confidence, and work quality.",
      "Finds key areas difficult and would benefit from guided support.",
      "Should review class material more consistently to improve results.",
      "Needs more attention to instructions, detail, and revision.",
      "Has not yet reached the expected level and needs extra reinforcement.",
      "Would benefit from more structured practice and feedback.",
      "Must strengthen basic understanding to make more secure progress.",
    ],
    at_risk: [
      "Is currently at risk and needs immediate academic support.",
      "Shows serious difficulty in meeting minimum expectations.",
      "Needs urgent intervention and close progress monitoring.",
      "Requires a structured support plan to improve safely.",
      "Current performance is a concern and needs timely follow-up.",
      "Struggles to work independently and needs targeted help.",
      "Needs consistent support at school and home to recover progress.",
      "Has major gaps in understanding and requires focused intervention.",
      "Should receive immediate support to prevent further decline.",
      "Needs close teacher guidance and frequent review at this stage.",
    ],
  },
};

const FAMILY_PATTERNS: Record<ReportCardCommentFamily, RegExp[]> = {
  mathematics: [/\bmath/i, /\balgebra/i, /\bgeometry/i, /\btrigon/i, /\barithmetic/i, /\bcalculus/i],
  languages: [/\benglish\b/i, /\burdu\b/i, /\barabic\b/i, /\blanguage\b/i, /\bliterature\b/i, /\bgrammar\b/i, /\bwriting\b/i, /\breading\b/i],
  science: [/\bscience\b/i, /\bphysics\b/i, /\bchem/i, /\bbiology\b/i, /\bcomputer\b/i, /\bstem\b/i],
  general: [],
};

export function resolveReportCardCommentFamily(subjectName: string): ReportCardCommentFamily {
  const value = subjectName.trim();
  for (const family of ["mathematics", "languages", "science"] as const) {
    if (FAMILY_PATTERNS[family].some((pattern) => pattern.test(value))) {
      return family;
    }
  }
  return "general";
}

export function getDefaultCommentCategory(percentage?: number | null): ReportCardCommentCategory {
  const value = Number(percentage || 0);
  if (value >= 90) return "extraordinary";
  if (value >= 75) return "good_better";
  if (value >= 60) return "average";
  if (value >= 40) return "below_average";
  return "at_risk";
}

export function getCommentCategoryLabel(category?: ReportCardCommentCategory | null) {
  return REPORT_CARD_COMMENT_CATEGORY_OPTIONS.find((option) => option.value === category)?.label || "Custom";
}

export function getCommentPresetsForSubject(
  subjectName: string,
  category: ReportCardCommentCategory
) {
  const family = resolveReportCardCommentFamily(subjectName);
  return COMMENT_LIBRARY[family][category];
}

export function getCommentPresetFamilies() {
  return COMMENT_LIBRARY;
}
