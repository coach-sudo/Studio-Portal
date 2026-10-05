import type { Recommendation } from "./model";
import type { CoverageData } from "./packageForecast";
import { forecastPackages } from "./packageForecast";

export function packageCoverageRecommendations(
  studentId: string,
  studioId: string,
  data: CoverageData,
  now: number,
): Recommendation[] {
  const items: Recommendation[] = [];
  for (const forecast of forecastPackages(studentId, data, now)) {
    const pkg = data.packages.find((item) => item.id === forecast.packageId)!;
    const add = (
      reasonCode: string,
      title: string,
      explanation: string,
      urgency: 4 | 5,
      lessonId?: string,
    ) =>
      items.push({
        id: `${reasonCode}:${pkg.id}`,
        studioId,
        studentId,
        entityType: "package",
        entityId: pkg.id,
        reasonCode,
        title,
        explanation,
        evidence: [
          `${forecast.currentCredits} current credits`,
          `${forecast.expectedConsumption} projected additional sessions`,
          `${forecast.projectedCredits} projected credits`,
          ...(lessonId ? [`First affected lesson ${lessonId}`] : []),
        ],
        urgency,
        suggestedAction: "review_package",
        requiresConfirmation: true,
      });
    if (forecast.uncoveredLessonIds.length)
      add(
        "PACKAGE_COVERAGE_SHORTFALL",
        "Package coverage shortfall",
        `${forecast.uncoveredLessonIds.length} upcoming eligible lesson(s) exceed current credits.`,
        5,
        forecast.firstUncoveredLessonId,
      );
    else if (
      forecast.projectedCredits <= 1 &&
      forecast.eligibleLessonIds.length
    )
      add(
        "PACKAGE_COVERAGE_LOW",
        "Projected package balance is low",
        `Currently scheduled lessons leave ${forecast.projectedCredits} session credit(s).`,
        4,
      );
    if (forecast.expiresBeforeLessonIds.length)
      add(
        "PACKAGE_EXPIRES_BEFORE_LESSON",
        "Package expires before a lesson",
        `${forecast.expiresBeforeLessonIds.length} upcoming lesson(s) occur after package expiration.`,
        5,
        forecast.expiresBeforeLessonIds[0],
      );
  }
  return items;
}
