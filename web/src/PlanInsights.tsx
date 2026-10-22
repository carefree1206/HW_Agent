import { Check, CircleHelp, Code2, Flag, GitBranch, X } from 'lucide-react'
import type { AppState, Plan } from './types'
import { Badge } from './common'

export function PlanningFailure({ state: s }: { state: AppState }) {
  const diagnosis = s.planning_diagnostics
  if (!diagnosis || diagnosis.status !== 'infeasible') return null
  const outdated = diagnosis.snapshot_version !== s.version
  return (
    <section className="panel diagnosis-panel" aria-label="不可行原因">
      <div className="panel-heading">
        <h2>
          <Flag size={17} />
          为什么无法生成方案
        </h2>
        <Badge tone={outdated ? '' : 'offline'}>
          {outdated ? '条件已变化 · 需重算' : '当前约束不可行'}
        </Badge>
      </div>
      <div className="diagnosis-body">
        {diagnosis.reasons.map((reason, index) => (
          <div className="diagnosis-row" key={`${reason.code}-${index}`}>
            <span className="diagnosis-icon">
              <X size={15} />
            </span>
            <div>
              <strong>
                {reason.region_name || '保障资源'}
                {reason.team_name ? ` · ${reason.team_name}` : ''}
              </strong>
              <p>{reason.detail}</p>
              {reason.shortfall_minutes !== undefined && (
                <div className="battery-comparison">
                  <span>现有 {reason.available_minutes} 分钟</span>
                  <i
                    style={{
                      width: `${Math.min(100, ((reason.available_minutes || 0) / (reason.required_minutes || 1)) * 100)}%`,
                    }}
                  />
                  <b>缺 {reason.shortfall_minutes} 分钟</b>
                </div>
              )}
            </div>
          </div>
        ))}
        {diagnosis.suggestions.length > 0 && (
          <div className="diagnosis-next">
            <CircleHelp size={16} />
            <div>
              <strong>可采取的下一步</strong>
              {diagnosis.suggestions.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
        )}
        <small>
          快照 v{diagnosis.snapshot_version} · 已检查 {diagnosis.assignments_checked} 种分配 ·{' '}
          {diagnosis.feasible_count} 种可行
        </small>
      </div>
    </section>
  )
}

export function PlanInsights({ plan }: { plan: Plan }) {
  if (!plan.alternatives?.length && !plan.validation) return null
  return (
    <section className="plan-insights" aria-label="方案选择依据">
      {plan.decision_rationale && (
        <div className="decision-rationale">
          <GitBranch size={16} />
          <div>
            <strong>为什么选择这个方案</strong>
            <p>{plan.decision_rationale}</p>
            {plan.comparison && (
              <span>
                对比 {plan.comparison.previous_plan_id}：最长预计恢复{' '}
                {plan.comparison.previous_eta_minutes} → {plan.eta_minutes} 分钟（
                {plan.comparison.eta_delta_minutes > 0 ? '+' : ''}
                {plan.comparison.eta_delta_minutes}）
              </span>
            )}
          </div>
        </div>
      )}
      {plan.alternatives && (
        <div className="table-scroll">
          <table className="comparison-table">
            <caption>有限模型中的可行分配比较</caption>
            <thead>
              <tr>
                <th>分配方案</th>
                <th>最晚恢复</th>
                <th>行程合计</th>
                <th>预留外电量余量</th>
              </tr>
            </thead>
            <tbody>
              {plan.alternatives.map((candidate) => (
                <tr key={candidate.id} className={candidate.selected ? 'selected-candidate' : ''}>
                  <td>
                    <span>
                      {candidate.selected && <Check size={13} />}
                      {candidate.id} {candidate.selected ? '已选' : '备选'}
                    </span>
                    <small>
                      {candidate.assignments
                        .map((a) => `${a.team_name.replace('通信保障', '')} → ${a.region_name}`)
                        .join(' / ')}
                    </small>
                  </td>
                  <td>{candidate.eta_minutes} 分钟</td>
                  <td>{candidate.travel_minutes} 分钟</td>
                  <td>
                    {candidate.safety_margin_minutes ?? '—'}
                    {candidate.safety_margin_minutes !== null && ' 分钟'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan.status !== 'executed' && plan.validation?.checks.length ? (
        <div className="validation-grid" aria-label="独立校验结果">
          {plan.validation.checks.map((check) => (
            <span className={check.passed ? 'passed' : 'failed'} key={check.id}>
              {check.passed ? <Check size={13} /> : <X size={13} />}
              {check.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="model-scope">
        <Code2 size={13} />
        仅比较当前拓扑、队伍和设备约束。人口加权等待与电量余量均为演练模型值。
      </div>
    </section>
  )
}
