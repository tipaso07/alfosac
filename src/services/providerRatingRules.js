const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const evaluateProviderRatingState = ({
  promedio,
  total,
  alertaCritica = false,
} = {}) => {
  const average = toNumber(promedio)
  const ratingsTotal = Math.max(0, Math.trunc(toNumber(total)))
  const critical = Boolean(alertaCritica)

  if (ratingsTotal <= 0) {
    return {
      key: 'sin-evaluaciones',
      label: 'Sin evaluaciones',
      averageLabel: 'Sin evaluaciones',
      showLowAlert: false,
      showCriticalAlert: false,
      colorClass: 'is-neutral',
    }
  }

  if (critical) {
    return {
      key: 'critico',
      label: 'Critico',
      averageLabel: `${average.toFixed(1)} / 5`,
      showLowAlert: average < 4,
      showCriticalAlert: true,
      colorClass: 'is-critical',
    }
  }

  if (average < 4) {
    return {
      key: 'bajo',
      label: 'Bajo',
      averageLabel: `${average.toFixed(1)} / 5`,
      showLowAlert: true,
      showCriticalAlert: false,
      colorClass: 'is-warning',
    }
  }

  return {
    key: 'normal',
    label: 'Normal',
    averageLabel: `${average.toFixed(1)} / 5`,
    showLowAlert: false,
    showCriticalAlert: false,
    colorClass: 'is-ok',
  }
}
