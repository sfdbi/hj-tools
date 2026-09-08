// 站点外壳：密码门禁 + 路由（门户首页 / 各工具页）
import { Routes, Route } from 'react-router';
import PasswordGate from '@/portal/PasswordGate';
import PortalHome from '@/portal/PortalHome';
import RatingTool from '@/tools/rating/RatingTool';
import FlowTool from '@/tools/flow/FlowTool';
import AttendanceTool from '@/tools/attendance/AttendanceTool';

export default function App() {
  return (
    <PasswordGate>
      <Routes>
        <Route path="/" element={<PortalHome />} />
        <Route path="/rating-curve" element={<RatingTool />} />
        <Route path="/flow-discharge" element={<FlowTool />} />
        <Route path="/attendance" element={<AttendanceTool />} />
        <Route path="*" element={<PortalHome />} />
      </Routes>
    </PasswordGate>
  );
}
