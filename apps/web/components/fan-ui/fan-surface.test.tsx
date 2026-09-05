import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import {FanSurface} from './fan-surface';
it('shares a static surface role without changing semantic content',()=>{
 render(<FanSurface tone="focus" aria-label="예약 일정"><h2>다가오는 LIVE</h2></FanSurface>);
 expect(screen.getByRole('region',{name:'예약 일정'})).toHaveAttribute('data-tone','focus');
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
