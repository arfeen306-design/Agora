BEGIN;

-- =====================================================
-- Phase 7: Transport, Library & Leave Self-Service
-- =====================================================

-- 1. Transport Routes
CREATE TABLE IF NOT EXISTS transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  route_name TEXT NOT NULL,
  route_code TEXT,
  description TEXT,
  schedule_type TEXT NOT NULL DEFAULT 'daily' CHECK (schedule_type IN ('daily', 'weekdays', 'custom')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, route_code)
);

-- 2. Transport Stops
CREATE TABLE IF NOT EXISTS transport_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  stop_name TEXT NOT NULL,
  stop_order INT NOT NULL DEFAULT 0,
  pickup_time TIME,
  dropoff_time TIME,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Transport Vehicles
CREATE TABLE IF NOT EXISTS transport_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  vehicle_number TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'bus' CHECK (vehicle_type IN ('bus', 'van', 'car', 'other')),
  capacity INT NOT NULL DEFAULT 40,
  driver_name TEXT,
  driver_phone TEXT,
  driver_license TEXT,
  route_id UUID REFERENCES transport_routes(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, vehicle_number)
);

-- 4. Transport Assignments (student ↔ route)
CREATE TABLE IF NOT EXISTS transport_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  stop_id UUID REFERENCES transport_stops(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('pickup', 'dropoff', 'both')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, route_id, direction)
);

-- 5. Library Books
CREATE TABLE IF NOT EXISTS library_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  publisher TEXT,
  edition TEXT,
  publish_year INT,
  total_copies INT NOT NULL DEFAULT 1,
  available_copies INT NOT NULL DEFAULT 1,
  shelf_location TEXT,
  description TEXT,
  cover_image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Library Transactions
CREATE TABLE IF NOT EXISTS library_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK (member_type IN ('student', 'staff')),
  member_id UUID NOT NULL, -- student_id or staff_profile_id
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'returned', 'overdue', 'lost')),
  fine_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  fine_paid BOOLEAN NOT NULL DEFAULT FALSE,
  issued_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  returned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Leave Requests (teacher/staff self-service)
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'casual' CHECK (leave_type IN ('casual', 'sick', 'annual', 'maternity', 'paternity', 'unpaid', 'other')),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  total_days NUMERIC(5,1) NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Indexes
CREATE INDEX idx_transport_routes_school ON transport_routes(school_id, is_active);
CREATE INDEX idx_transport_stops_route ON transport_stops(route_id, stop_order);
CREATE INDEX idx_transport_vehicles_school ON transport_vehicles(school_id, is_active);
CREATE INDEX idx_transport_assignments_student ON transport_assignments(school_id, student_id);
CREATE INDEX idx_transport_assignments_route ON transport_assignments(route_id, is_active);
CREATE INDEX idx_library_books_school ON library_books(school_id, is_active);
CREATE INDEX idx_library_books_isbn ON library_books(school_id, isbn) WHERE isbn IS NOT NULL;
CREATE INDEX idx_library_transactions_book ON library_transactions(book_id, status);
CREATE INDEX idx_library_transactions_member ON library_transactions(school_id, member_type, member_id);
CREATE INDEX idx_library_transactions_overdue ON library_transactions(due_at) WHERE status = 'issued';
CREATE INDEX idx_leave_requests_staff ON leave_requests(school_id, staff_profile_id, status);
CREATE INDEX idx_leave_requests_pending ON leave_requests(school_id, status) WHERE status = 'pending';

-- 9. Triggers
CREATE TRIGGER trg_transport_routes_updated_at BEFORE UPDATE ON transport_routes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transport_stops_updated_at BEFORE UPDATE ON transport_stops FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transport_vehicles_updated_at BEFORE UPDATE ON transport_vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transport_assignments_updated_at BEFORE UPDATE ON transport_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_library_books_updated_at BEFORE UPDATE ON library_books FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_library_transactions_updated_at BEFORE UPDATE ON library_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leave_requests_updated_at BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 10. New roles
INSERT INTO roles (school_id, name, code, is_system)
SELECT s.id, 'Transport Admin', 'transport_admin', TRUE FROM schools s
ON CONFLICT DO NOTHING;

INSERT INTO roles (school_id, name, code, is_system)
SELECT s.id, 'Librarian', 'librarian', TRUE FROM schools s
ON CONFLICT DO NOTHING;

COMMIT;
