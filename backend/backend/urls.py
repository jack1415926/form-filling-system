"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
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
from django.urls import path
from changes import views
from changes.emc_views import EmcDetail
from changes.execution_plan_views import ExecutionPlanDetail
from changes.significant_change_views import SignificantChangeDetail
from changes.submission_views import ReviewerList, ActionOwnerList
from changes.review_views import ReviewList, ReviewDetail
from changes.round_snapshots import RoundFormSnapshot
from changes.stage_workflow import StageDetail, StageSubmission, TaskDetail
from changes.publication import PublicationList, AllPublicationList, PublicationDetail, CreateEco
from changes.eco_filler import EcoFillerDetail, EcoFillerReceipt, EcoFillerInbox, EcoFillerMarkRead
from changes.stage_navigation import StageNavigation, SourceEcr
from changes.engineering_changes import EngineeringChanges
from changes.test_case_views import TestCaseCreate
from changes.review_inbox import ReviewInbox, MarkInboxRead
from changes.system_feedback_views import FeedbackList, FeedbackDetail, FeedbackRequest, ManagedList, ManagedDetail, ManagedAction, ManagedRequest
from changes.system_feedback_views import FeedbackFollowup, FollowupRequest, FeedbackInbox, FeedbackMarkRead

urlpatterns = [
    path('api/test-cases/', TestCaseCreate.as_view()),
    path('api/eco-filler/inbox/', EcoFillerInbox.as_view()),
    path('api/eco-filler/inbox/read/', EcoFillerMarkRead.as_view()),
    path('api/engineering-changes/', EngineeringChanges.as_view()),
    path('api/publications/', AllPublicationList.as_view()),
    path('api/changes/<int:pk>/stage-navigation/', StageNavigation.as_view()),
    path('api/changes/<int:pk>/source-ecr/', SourceEcr.as_view()),
    path('api/ecr-publications/', PublicationList.as_view()),
    path('api/changes/<int:pk>/publication/', PublicationDetail.as_view()),
    path('api/changes/<int:pk>/eco/', CreateEco.as_view()),
    path('api/changes/<int:pk>/eco-filler/', EcoFillerDetail.as_view()),
    path('api/changes/<int:pk>/eco-filler/requests/<uuid:request_id>/', EcoFillerReceipt.as_view()),
    path('api/changes/<int:pk>/stage-workflow/', StageDetail.as_view()),
    path('api/changes/<int:pk>/stage-submission/', StageSubmission.as_view()),
    path('api/changes/<int:pk>/action-tasks/<int:task_id>/', TaskDetail.as_view()),
    path('api/system-feedback/', FeedbackList.as_view()),
    path('api/system-feedback/inbox/', FeedbackInbox.as_view()),
    path('api/system-feedback/inbox/read/', FeedbackMarkRead.as_view()),
    path('api/system-feedback/requests/<uuid:request_id>/', FeedbackRequest.as_view()),
    path('api/system-feedback/manage/', ManagedList.as_view()),
    path('api/system-feedback/manage/<int:pk>/', ManagedDetail.as_view()),
    path('api/system-feedback/manage/<int:pk>/actions/', ManagedAction.as_view()),
    path('api/system-feedback/manage/<int:pk>/requests/<uuid:request_id>/', ManagedRequest.as_view()),
    path('api/system-feedback/<int:pk>/', FeedbackDetail.as_view()),
    path('api/system-feedback/<int:pk>/followups/', FeedbackFollowup.as_view()),
    path('api/system-feedback/<int:pk>/requests/<uuid:request_id>/', FollowupRequest.as_view()),
    path('admin/', admin.site.urls),
    path('api/auth/csrf/', views.csrf_view),
    path('api/auth/login/', views.login_view),
    path('api/auth/logout/', views.logout_view),
    path('api/auth/me/', views.me_view),
    path('api/reviewers/', ReviewerList.as_view()),
    path('api/action-owners/', ActionOwnerList.as_view()),
    path('api/review/', ReviewList.as_view()),
    path('api/review/inbox/', ReviewInbox.as_view()),
    path('api/review/inbox/read/', MarkInboxRead.as_view()),
    path('api/changes/<int:pk>/review-rounds/<int:number>/form-snapshot/', RoundFormSnapshot.as_view()),
    path('api/changes/<int:pk>/review-rounds/<int:number>/', ReviewDetail.as_view()),
    path('api/changes/<int:pk>/review-rounds/<int:number>/<str:action>/', ReviewDetail.as_view()),
    path('api/changes/<int:pk>/emc/', EmcDetail.as_view()),
    path('api/changes/<int:pk>/execution-plan/', ExecutionPlanDetail.as_view()),
    path('api/changes/<int:pk>/significant-change/', SignificantChangeDetail.as_view()),
    path('api/changes/', views.ChangeList.as_view()),
    path('api/changes/<int:pk>/', views.ChangeDetail.as_view()),
    path('api/changes/<int:pk>/materials/', views.MaterialList.as_view()),
    path('api/changes/<int:pk>/questions/', views.QuestionList.as_view()),
    path('api/changes/<int:pk>/ecr-actions/', views.EcrActionList.as_view()),
    path('api/changes/<int:pk>/ecr-actions/<str:action_key>/', views.EcrActionDetail.as_view()),
    path('api/changes/<int:pk>/eco-actions/', views.EcoActionList.as_view()),
    path('api/changes/<int:pk>/eco-actions/<str:action_key>/', views.EcoActionDetail.as_view()),
    path('api/changes/<int:pk>/materials/<int:material_pk>/', views.MaterialDetail.as_view()),
]
