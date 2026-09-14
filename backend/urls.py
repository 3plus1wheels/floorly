"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.http import HttpResponse, JsonResponse
from pathlib import Path

_INDEX = Path(__file__).resolve().parent.parent / 'frontend' / 'build' / 'index.html'

def _react_index(request):
    try:
        return HttpResponse(_INDEX.read_text(encoding='utf-8'), content_type='text/html')
    except FileNotFoundError:
        return HttpResponse('<p>Frontend not built. Run: cd frontend &amp;&amp; npm run build</p>', status=503)


def _health(request):
    return JsonResponse({'status': 'ok'})

urlpatterns = [
    path('health/', _health, name='health'),
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    path('api/auth/', include('api.auth_urls')),
    path('api/schedule/', include('schedule.urls')),
    re_path(r'^(?!static/|api/|admin/|health/).*$', _react_index),
]
