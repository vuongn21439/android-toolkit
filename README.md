# Android Toolkit

Ứng dụng web kiểm tra cấu trúc APK / ZIP dự án Android ngay trong trình duyệt.
Tệp được xử lý trong bộ nhớ trình duyệt, không tải lên máy chủ.

## Triển khai lên GitHub Pages

1. Tạo repo mới trên GitHub, đẩy **toàn bộ thư mục này** lên nhánh `main`
   (`package.json` nằm ở gốc repo, `.github/` nằm ở gốc repo).
2. Vào **Settings → Pages → Build and deployment → Source** và chọn **GitHub Actions**.
3. Mỗi lần push lên `main`, workflow `Deploy to GitHub Pages` sẽ tự build và đăng.
4. Địa chỉ: `https://<tên-github>.github.io/<tên-repo>/`

Khuyến nghị: chạy `npm install` một lần ở máy cá nhân rồi commit `package-lock.json`
để các lần build sau dùng đúng phiên bản (workflow tự chuyển sang `npm ci` khi có file này).

## Chạy thử cục bộ

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # xuất ra dist/
npm run preview    # http://localhost:4173
```

## Những gì đã đổi so với bản gốc

- `vite.config.ts`: bỏ yêu cầu biến `PORT`/`BASE_PATH` và các plugin Replit; dùng `base: './'`
  (đường dẫn tương đối) nên chạy được ở bất kỳ thư mục con nào.
- `src/App.tsx`: router dùng hash (`#/`), tránh lỗi 404 khi tải lại trang trên GitHub Pages.
- `package.json`: thay `catalog:` / `workspace:*` bằng phiên bản cụ thể, bỏ các gói không dùng.
- `tsconfig.json`: độc lập, không còn `extends` / `references` ra ngoài repo.
- Thêm `.github/workflows/deploy.yml`, `.gitignore`, `.npmrc`.
