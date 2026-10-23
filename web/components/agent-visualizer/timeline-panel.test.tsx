import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TimelinePanel } from './timeline-panel'

describe('TimelinePanel', () => {
  it('refreshes its time markers only while visible', () => {
    const props = { timelineEntries: new Map(), onClose: () => {} }
    const { rerender } = render(<TimelinePanel {...props} visible={false} currentTime={10} />)

    rerender(<TimelinePanel {...props} visible={false} currentTime={30} />)
    expect(screen.queryByText('30s')).not.toBeInTheDocument()

    rerender(<TimelinePanel {...props} visible currentTime={30} />)
    expect(screen.getByText('30s')).toBeInTheDocument()
  })
})
