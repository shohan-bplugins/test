import { useRouteNav } from "~/components/polaris/helpers";
import { isUnlimited } from "~/lib/billing-constants";

interface CatalogCoverageCardProps {
  assigned: number;
  totalProducts: number;
  distinctModelsUsed: number;
  modelLimit: number;
  productLimit: number;
  planTitle: string;
  uploadsThisMonth: number;
  uploadsLastMonth: number;
  monthStartLabel: string;
  lastMonthLabel: string;
}

export function CatalogCoverageCard({
  assigned,
  totalProducts,
  distinctModelsUsed,
  modelLimit,
  productLimit,
  planTitle,
  uploadsThisMonth,
  uploadsLastMonth,
  monthStartLabel,
  lastMonthLabel,
}: CatalogCoverageCardProps) {
  const routeTo = useRouteNav();

  const total = Math.max(0, totalProducts);
  const countWithModel = Math.max(0, assigned);
  const remaining = Math.max(0, total - countWithModel);
  const percent = total > 0 ? Math.min(100, Math.round((countWithModel / total) * 100)) : 0;
  const delta = uploadsThisMonth - uploadsLastMonth;

  const isModelUnlimited = isUnlimited(modelLimit);
  const isProductUnlimited = isUnlimited(productLimit);

  const modelBadgeText = isModelUnlimited
    ? "Unlimited models"
    : `${modelLimit} models`;

  const planSubtext = isProductUnlimited
    ? "Unlimited plan"
    : `${planTitle || "Free"} plan`;

  return (
    <s-section>
      <style>{COVERAGE_CSS}</style>
      <div className="cc-container">
        {/* Top Header Row */}
        <div className="cc-header">
          <h2 className="cc-title">3D catalog coverage</h2>
          <span className="cc-badge">{modelBadgeText}</span>
        </div>

        {/* Coverage Progress Section */}
        <div className="cc-coverage-body">
          <div className="cc-numbers-row">
            <span className="cc-coverage-label">
              <strong className="cc-bold">{countWithModel} of {total}</strong> products have a 3D model
            </span>
            <span className="cc-percentage">{percent}%</span>
          </div>

          <div className="cc-progress-track">
            <div
              className="cc-progress-fill"
              style={{ width: `${percent}%` }}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          <div className="cc-sub-row">
            <span className="cc-sub-text">
              {remaining > 0
                ? `${remaining} ${remaining === 1 ? "product still shows" : "products still show"} regular images only.`
                : "All products have a 3D model."}
            </span>
            <a
              href="/app/products"
              onClick={routeTo("/app/products")}
              className="cc-assign-link"
            >
              Assign models to products
            </a>
          </div>
        </div>

        {/* Divider */}
        <hr className="cc-divider" />

        {/* 3-Column Stats Row */}
        <div className="cc-stats-grid">
          {/* Column 1 */}
          <div className="cc-stat-card">
            <span className="cc-stat-title">Products with a model</span>
            <span className="cc-stat-number">{countWithModel}</span>
            <span className="cc-stat-note">{planSubtext}</span>
          </div>

          {/* Column 2 */}
          <div className="cc-stat-card">
            <span className="cc-stat-title">Models in use</span>
            <span className="cc-stat-number">{distinctModelsUsed}</span>
            <span className="cc-stat-note">
              Library files and product assignments, counted once
            </span>
          </div>

          {/* Column 3 */}
          <div className="cc-stat-card">
            <span className="cc-stat-title">Uploads this month</span>
            <div className="cc-stat-val-badge-row">
              <span className="cc-stat-number">{uploadsThisMonth}</span>
              {delta !== 0 ? (
                <span
                  className={`cc-delta-pill ${
                    delta > 0 ? "cc-delta-pos" : "cc-delta-neg"
                  }`}
                >
                  {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
                </span>
              ) : null}
            </div>
            <span className="cc-stat-note">
              Since {monthStartLabel}. {lastMonthLabel}: {uploadsLastMonth}
            </span>
          </div>
        </div>
      </div>
    </s-section>
  );
}

const COVERAGE_CSS = `
.cc-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.cc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.cc-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #202223;
  line-height: 24px;
  letter-spacing: -0.01em;
}

.cc-badge {
  display: inline-flex;
  align-items: center;
  background-color: #e4f8ed;
  color: #108043;
  font-size: 13px;
  font-weight: 500;
  padding: 3px 12px;
  border-radius: 9999px;
  line-height: 18px;
  white-space: nowrap;
}

.cc-coverage-body {
  display: flex;
  flex-direction: column;
}

.cc-numbers-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.cc-coverage-label {
  font-size: 14px;
  color: #303030;
  line-height: 20px;
}

.cc-bold {
  font-weight: 700;
  color: #202223;
}

.cc-percentage {
  font-size: 14px;
  font-weight: 500;
  color: #4b5563;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
}

.cc-progress-track {
  width: 100%;
  height: 8px;
  background-color: #e5e7eb;
  border-radius: 9999px;
  overflow: hidden;
  margin-bottom: 10px;
}

.cc-progress-fill {
  height: 100%;
  background-color: #2b2c2d;
  border-radius: 9999px;
  transition: width 0.3s ease;
}

.cc-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.cc-sub-text {
  font-size: 13.5px;
  color: #6d7175;
  line-height: 20px;
}

.cc-assign-link {
  font-size: 13.5px;
  font-weight: 600;
  color: #005bd3;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}

.cc-assign-link:hover {
  text-decoration: underline;
}

.cc-divider {
  border: none;
  height: 1px;
  background-color: #e5e7eb;
  margin: 22px 0 20px 0;
  width: 100%;
}

.cc-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

@media (max-width: 640px) {
  .cc-stats-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

.cc-stat-card {
  display: flex;
  flex-direction: column;
}

.cc-stat-title {
  font-size: 13.5px;
  font-weight: 500;
  color: #6d7175;
  line-height: 20px;
}

.cc-stat-number {
  font-size: 24px;
  font-weight: 700;
  color: #202223;
  line-height: 32px;
  margin: 2px 0;
  font-variant-numeric: tabular-nums;
}

.cc-stat-val-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0;
}

.cc-stat-val-badge-row .cc-stat-number {
  margin: 0;
}

.cc-delta-pill {
  display: inline-flex;
  align-items: center;
  font-size: 12.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 9999px;
  line-height: 16px;
}

.cc-delta-pos {
  background-color: #e4f8ed;
  color: #108043;
}

.cc-delta-neg {
  background-color: #f6f6f7;
  color: #6d7175;
}

.cc-stat-note {
  font-size: 13px;
  color: #6d7175;
  line-height: 18px;
}

@media (prefers-color-scheme: dark) {
  .cc-title,
  .cc-bold,
  .cc-stat-number {
    color: #e3e3e3;
  }
  .cc-coverage-label,
  .cc-percentage {
    color: #a3a3a3;
  }
  .cc-progress-track {
    background-color: #333333;
  }
  .cc-progress-fill {
    background-color: #e3e3e3;
  }
  .cc-sub-text,
  .cc-stat-title,
  .cc-stat-note {
    color: #8c8c8c;
  }
  .cc-divider {
    background-color: #2e2e2e;
  }
  .cc-badge,
  .cc-delta-pos {
    background-color: rgba(16, 128, 67, 0.2);
    color: #4ddbb5;
  }
  .cc-assign-link {
    color: #458fff;
  }
}
`;
